"""
Scuba Analyzer: backend API (Flask)

HOW IT FITS TOGETHER
--------------------
The frontend pages call this server. Each function below with an
@app.route(...) line above it is one "route": a URL the frontend can call.
The routes stay small because the real work lives in other files:

    workflow.py   asks the AI model to score an essay and to make topics
    checks.py     checks done BEFORE scoring (off-topic? written by an AI?)
    reports.py    builds the three PDF reports
    auth.py       checks who is signed in (only used when Firebase is on)

RUN IT
------
    cd backend
    python -m pip install -r requirements.txt
    (put your GROQ_API_KEY in the .env file)
    python app.py

The server runs on http://localhost:5000. Keep it running in a terminal while
you use the frontend (start the frontend with `python serve.py` in frontend/).

ROUTES
------
    GET  /health
         -> {"status": "ok"}   (use it to check the server is running)

    POST /generate-topic
         body:    {"domain": str, "level": str, "exclude": [str, ...]}
         returns: {"topic": str, "keywords": [str, ...], "domain": str, "level": str}
         `exclude` is optional: topics already shown, so the AI does not repeat them.

    POST /evaluate
         body:    {"essay": str, "topic": str, "domain": str}
         returns: {
                    "semantic":  {"score": int, "feedback": str, "corrections": [{"original_text", "expected", "correction"}, ...]},
                    "stylistic": {... same shape ...},
                    "pragmatic": {... same shape ...},
                    "avg_score": number,
                    "overall_feedback": str,
                    "topic": str, "domain": str,
                    "irrelevant": bool,    # true = essay was off-topic, every score is 0
                    "ai_generated": {"detected": bool, "confidence": int, "reason": str}
                  }

    POST /download-pdf
         body:    {"report_type": "ai" | "admin" | "comparison", ...report data...}
         returns: the PDF file

    POST /send-email
         body:    {"to": str, ...the /evaluate result...}
         sends the student's AI result by email (through the n8n webhook)

    POST /send-comparison-email
         body:    {"to": str, ..., "avg_score", "admin_score", "admin_feedback", ...}
         sends the AI-vs-admin comparison and 3 PDFs by email (through n8n)
"""

# ── Imports ─────────────────────────────────────────────────────
import base64
import io
import os

import requests
from dotenv import load_dotenv

load_dotenv()  # reads the .env file; must run BEFORE workflow.py is imported (it needs GROQ_API_KEY)

from flask import g, Flask, jsonify, request, send_file
from flask_cors import CORS

from workflow import evaluate_essay, generate_topic
from auth import require_auth
from checks import run_checks, zero_score_result
from reports import build_ai_report_pdf, build_admin_report_pdf, build_comparison_report_pdf
from excel_export import build_participants_xlsx

# ── App setup ───────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)  # lets the frontend (a different address, localhost:8000) call this server


# ── Routes: health, topic, evaluate, PDF ────────────────────────


@app.route("/health", methods=["GET"])
def health():
    """Quick check that the server is up."""
    return jsonify({"status": "ok"})


@app.route("/generate-topic", methods=["POST"])
@require_auth()
def generate_topic_route():
    """Ask the AI for a new essay topic in the chosen domain and difficulty."""
    data = request.get_json(force=True, silent=True) or {}
    domain = (data.get("domain") or "General").strip()
    level = (data.get("level") or "Medium").strip()
    exclude = data.get("exclude") or []
    if not isinstance(exclude, list):
        exclude = []

    try:
        result = generate_topic(domain, level, exclude=exclude)
    except Exception as exc:  # e.g. missing/invalid GROQ_API_KEY, network error
        return jsonify({"error": str(exc)}), 500

    return jsonify({
        "topic": result["topic"],
        "keywords": result["keywords"],
        "domain": domain,
        "level": level,
    })


@app.route("/evaluate", methods=["POST"])
@require_auth()
def evaluate_route():
    """Score an essay. Steps: (1) basic length check, (2) pre-checks for off-topic
    and AI-written text, (3) if on topic, run the scoring workflow."""
    data = request.get_json(force=True, silent=True) or {}
    essay = (data.get("essay") or "").strip()
    topic = (data.get("topic") or "").strip()
    domain = (data.get("domain") or "").strip()

    if len(essay) < 50:
        return jsonify({"error": "Essay is too short to evaluate (minimum 50 characters)."}), 400

    # Step 2: pre-checks (see checks.py): is the essay on topic, does it look AI-written?
    checks = run_checks(essay, topic)
    ai_generated = checks["ai_generated"]

    if not checks["is_relevant"]:
        # Off-topic essay -> straight to zero, workflow is not run at all.
        zero = zero_score_result(checks["relevance_reason"])
        return jsonify({
            "topic": topic,
            "domain": domain,
            **zero,
            "irrelevant": True,
            "ai_generated": ai_generated,
        })

    # Step 3: the essay is on topic, so score it with the AI workflow (see workflow.py).
    try:
        state = evaluate_essay(essay)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    return jsonify({
        "topic": topic,
        "domain": domain,
        "irrelevant": False,
        "ai_generated": ai_generated,
        "semantic": {
            "score": state.get("semantic_score"),
            "feedback": state.get("semantic_feedback"),
            "corrections": state.get("semantic_corrections") or [],
        },
        "stylistic": {
            "score": state.get("stylistic_score"),
            "feedback": state.get("stylistic_feedback"),
            "corrections": state.get("stylistic_corrections") or [],
        },
        "pragmatic": {
            "score": state.get("pragmatic_score"),
            "feedback": state.get("pragmatic_feedback"),
            "corrections": state.get("pragmatic_corrections") or [],
        },
        "avg_score": state.get("avg_score"),
        "overall_feedback": state.get("overall_feedback"),
    })


@app.route("/download-pdf", methods=["POST"])
@require_auth()
def download_pdf():
    """
    Body: { "report_type": "ai" | "admin", ...report data... }

    "ai"    needs: domain, topic, essay, semantic, stylistic, pragmatic,
            avg_score, overall_feedback (i.e. exactly what /evaluate returns).
    "admin" needs the same, plus admin_score and admin_feedback — there's no
            stored reviewer role in this app, so the admin's score/feedback
            just travel in with the download request itself.
    """
    data = request.get_json(force=True, silent=True) or {}
    report_type = (data.get("report_type") or "ai").lower()

    # Pick the right report builder (all are in reports.py) and the file name to save as.
    try:
        if report_type == "comparison":
            pdf_bytes = build_comparison_report_pdf(data)
            download_name = "comparison_report.pdf"
        elif report_type == "admin":
            pdf_bytes = build_admin_report_pdf(data)
            download_name = "admin_report.pdf"
        else:
            pdf_bytes = build_ai_report_pdf(data)
            download_name = "ai_report.pdf"
    except Exception as exc:
        # Without this, any crash inside PDF generation (bad/missing field,
        # an fpdf2 layout edge case, etc.) surfaces to the browser as a bare
        # 500 with an HTML error page — fetch() can't parse that as JSON, so
        # the frontend just shows "download failed" with no real reason.
        # Logging + a JSON error lets the actual cause show up in both the
        # server console and the toast on the frontend.
        app.logger.exception("PDF generation failed (report_type=%s)", report_type)
        return jsonify({"error": f"Couldn't generate the PDF: {exc}"}), 500

    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=download_name,
    )


@app.route("/export-excel", methods=["POST"])
@require_auth(admin=True)
def export_excel():
    """
    Body: { "rows": [ one object per participant ], "exit_threshold": N }   (built by buildParticipantRows in frontend/js/participants.js)
    Returns an .xlsx file: Participants sheet, Dashboard sheet (with spider graph), Dimension scores sheet.
    Admin only when sign-in is on.
    """
    data = request.get_json(force=True, silent=True) or {}
    rows = data.get("rows")
    if not isinstance(rows, list) or not rows:
        return jsonify({"error": "There are no participants to export yet."}), 400
    if len(rows) > 5000:
        return jsonify({"error": "Too many participants in one export (max 5000)."}), 400
    try:
        xlsx_bytes = build_participants_xlsx(rows, data.get("exit_threshold") or 1)
    except Exception as exc:
        app.logger.exception("Excel export failed")
        return jsonify({"error": f"Couldn't generate the Excel file: {exc}"}), 500
    return send_file(
        io.BytesIO(xlsx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="participants.xlsx",
    )


# ── Helpers for the email routes ────────────────────────────────
def _valid_email(addr: str) -> bool:
    """Very simple check: has an @ and a dot after it."""
    return bool(addr) and "@" in addr and "." in addr.split("@")[-1]


def _post_to_n8n(url: str, payload: dict):
    """POST to the n8n webhook. Returns (ok, error_message)."""
    headers = {}
    secret = os.getenv("N8N_WEBHOOK_SECRET", "").strip()
    if secret:
        headers["X-Webhook-Secret"] = secret  # optional: match it in the n8n Webhook node's header auth
    try:
        r = requests.post(url, json=payload, headers=headers, timeout=45)
        r.raise_for_status()
        return True, ""
    except requests.RequestException as exc:
        app.logger.exception("n8n webhook call failed")
        hint = ""
        if getattr(exc, "response", None) is not None and exc.response.status_code == 404:
            hint = (" (404 = n8n has no ACTIVE workflow at this URL: import n8n/genai_assess_email.json, "
                    "open its Webhook node, and click Publish/Activate.)")
        return False, f"Couldn't reach n8n: {exc}{hint}"


def _attachment(filename: str, pdf_bytes: bytes) -> dict:
    """Packs a PDF so it can travel inside the JSON sent to n8n (n8n turns it back into a file)."""
    return {"filename": filename, "base64": base64.b64encode(pdf_bytes).decode("ascii")}


# ── Routes: email ───────────────────────────────────────────────
@app.route("/send-email", methods=["POST"])
@require_auth()
def send_email():
    """
    Student's own result (AI scores). Body: { "to", "name", "domain", "topic", "avg_score",
    "semantic", "stylistic", "pragmatic", "overall_feedback", "ai_generated", "irrelevant" }
    Forwards to the n8n webhook (n8n/genai_assess_email.json) with type="result".
    """
    data = request.get_json(force=True, silent=True) or {}
    to = (data.get("to") or "").strip()
    if g.user:                       # sign-in on: always the caller's Google-VERIFIED email, never a typed one
        to = g.user["email"].lower()
    if not _valid_email(to):
        return jsonify({"error": "Please provide a valid email address."}), 400
    webhook = os.getenv("N8N_WEBHOOK_URL", "").strip()
    if not webhook:
        return jsonify({"error": "N8N_WEBHOOK_URL is not set in backend/.env."}), 500

    # Everything n8n needs to build the email (n8n/genai_assess_email.json reads these names).
    payload = {
        "type": "result",
        "to": to,
        "name": data.get("name") or "Student",
        "domain": data.get("domain") or "",
        "topic": data.get("topic") or "",
        "avg_score": data.get("avg_score"),
        "semantic": data.get("semantic") or {},
        "stylistic": data.get("stylistic") or {},
        "pragmatic": data.get("pragmatic") or {},
        "overall_feedback": data.get("overall_feedback") or "",
        "irrelevant": bool(data.get("irrelevant")),
        "ai_generated": data.get("ai_generated") or {},
        "attachments": [],
    }
    try:  # attach the AI report when the essay text was supplied
        if data.get("essay"):
            payload["attachments"].append(_attachment("ai_report.pdf", build_ai_report_pdf(data)))
    except Exception:
        app.logger.exception("AI report PDF for result email failed; sending without it")

    ok, err = _post_to_n8n(webhook, payload)
    if not ok:
        return jsonify({"error": err}), 502
    return jsonify({"status": "sent", "to": to})


@app.route("/send-comparison-email", methods=["POST"])
@require_auth(admin=True)
def send_comparison_email():
    """
    Called automatically once BOTH reports exist (AI evaluation + admin review).
    Generates three PDFs - the AI report, the admin report and the AI-vs-Admin
    comparison report - and sends them with the student's name and both marks
    through the n8n webhook (type="comparison").

    Body: { "to", "name", "domain", "topic", "essay", "avg_score", "semantic",
            "stylistic", "pragmatic", "overall_feedback", "admin_score",
            "admin_feedback", "irrelevant", "ai_generated" }
    """
    data = request.get_json(force=True, silent=True) or {}
    to = (data.get("to") or "").strip()
    if not _valid_email(to):
        return jsonify({"error": "Please provide a valid email address."}), 400
    if data.get("admin_score") in (None, ""):
        return jsonify({"error": "admin_score is required for the comparison email."}), 400

    webhook = (os.getenv("N8N_COMPARISON_WEBHOOK_URL", "").strip()
               or os.getenv("N8N_WEBHOOK_URL", "").strip())
    if not webhook:
        return jsonify({"error": "N8N_WEBHOOK_URL is not set in backend/.env."}), 500

    # Build the three PDF attachments first; if that fails, nothing is sent.
    try:
        attachments = [
            _attachment("comparison_report.pdf", build_comparison_report_pdf(data)),
            _attachment("ai_report.pdf", build_ai_report_pdf(data)),
            _attachment("admin_report.pdf", build_admin_report_pdf(data)),
        ]
    except Exception as exc:
        app.logger.exception("Report PDF generation failed")
        return jsonify({"error": f"Couldn't generate the reports: {exc}"}), 500

    # Difference between the admin and AI scores, written with 2 decimals.
    try:
        diff = round(float(data.get("admin_score")) - float(data.get("avg_score")), 2)
        diff = f"{diff + 0.0:.2f}"      # always 2 decimals ("1.10", "-0.50", "0.00"); n8n prefixes '+'
    except (TypeError, ValueError):
        diff = None

    # Everything n8n needs to build the email (n8n/genai_assess_email.json reads these names).
    payload = {
        "type": "comparison",
        "to": to,
        "name": data.get("name") or "Student",
        "domain": data.get("domain") or "",
        "topic": data.get("topic") or "",
        "ai_marks": data.get("avg_score"),
        "admin_marks": data.get("admin_score"),
        "difference": diff,
        "overall_feedback": data.get("overall_feedback") or "",
        "admin_feedback": data.get("admin_feedback") or "",
        "irrelevant": bool(data.get("irrelevant")),
        "ai_generated": data.get("ai_generated") or {},
        "attachments": attachments,
    }
    ok, err = _post_to_n8n(webhook, payload)
    if not ok:
        return jsonify({"error": err}), 502
    return jsonify({"status": "sent", "to": to, "attachments": [a["filename"] for a in attachments]})


# ── Start the server (python app.py) ────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)