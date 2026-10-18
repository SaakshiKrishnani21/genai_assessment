"""
Firebase sign-in checks for the Flask backend.

IN PLAIN WORDS
--------------
When sign-in is on, the browser sends a "ticket" (a Firebase ID token) with each
request. This file checks the ticket is real and not expired, and, for admin
routes, checks the person is on the admin list. If anything is wrong the
request is refused. If sign-in is off (local mode), every request is allowed.

DETAILS
-------

Turned ON by setting FIREBASE_PROJECT_ID in backend/.env. When it is not set
the backend behaves exactly as before (no sign-in required) so local mode keeps
working.

When ON, every API route except /health needs the header
    Authorization: Bearer <Firebase ID token>
which the frontend sends automatically. The token is verified against Google's
public keys (no secret/service-account needed), and the Google email must be
verified. Routes marked admin=True additionally require the caller to be an
admin: a document must exist at  admins/<their-email-lowercase>  in Firestore.
That lookup is made WITH THE CALLER'S OWN TOKEN through Firestore's REST API,
so the Firestore security rules decide - the same single source of truth the
frontend uses, editable only by you in the Firebase console.
"""
import logging
import os
import time
from functools import wraps
from urllib.parse import quote

import requests
from flask import g, jsonify, request
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token as g_id_token

log = logging.getLogger(__name__)
_transport = g_requests.Request()   # used to download Google's public keys for checking tickets

# Remembers "is this email an admin?" for 60 seconds so we do not ask Firestore on every click.
_ADMIN_CACHE: dict[str, tuple[float, bool]] = {}   # email -> (expires_at, is_admin)
_ADMIN_TTL = 60  # seconds


def project_id() -> str:
    """The Firebase project ID from the .env file (empty = sign-in is off)."""
    return os.getenv("FIREBASE_PROJECT_ID", "").strip()


def auth_enabled() -> bool:
    """Sign-in is on only when FIREBASE_PROJECT_ID is set."""
    return bool(project_id())


def verify_token(token: str) -> dict:
    """Return the verified claims or raise ValueError."""
    claims = g_id_token.verify_firebase_token(token, _transport, audience=project_id())
    if not claims:
        raise ValueError("token could not be verified")
    if not claims.get("email") or not claims.get("email_verified"):
        raise ValueError("the Google email is not verified")
    return claims


def is_admin(claims: dict, token: str) -> bool:
    """True if admins/<email> exists in Firestore (read with the caller's own token)."""
    email = claims["email"].lower()
    # 1) Use the remembered answer if it is still fresh.
    hit = _ADMIN_CACHE.get(email)
    if hit and hit[0] > time.time():
        return hit[1]
    # 2) Otherwise ask Firestore whether the document admins/<email> exists.
    url = (f"https://firestore.googleapis.com/v1/projects/{project_id()}"
           f"/databases/(default)/documents/admins/{quote(email, safe='')}")
    try:
        r = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=10)
    except requests.RequestException:
        log.exception("Admin lookup failed (network); denying admin access")
        return False
    if r.status_code not in (200, 403, 404):
        log.warning("Unexpected Firestore status %s during admin lookup; denying", r.status_code)
        return False
    ok = r.status_code == 200   # 200 = document exists = admin; 403/404 = not an admin
    _ADMIN_CACHE[email] = (time.time() + _ADMIN_TTL, ok)
    return ok


def require_auth(admin: bool = False):
    """Put @require_auth() above a route to protect it (or @require_auth(admin=True)
    for admin-only routes). Does nothing while sign-in is off.

    The two inner functions are the usual shape of a Python decorator:
    deco() receives the route function, wrapper() runs the checks first and
    then calls the route function if everything is fine.
    """
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if not auth_enabled():
                g.user = None
                return fn(*args, **kwargs)
            # Sign-in is on: read the ticket from the "Authorization: Bearer <token>" header.
            header = request.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                return jsonify({"error": "Please sign in first."}), 401
            token = header[7:].strip()
            try:
                claims = verify_token(token)
            except Exception as exc:  # expired, wrong project, bad signature, unverified email...
                return jsonify({"error": f"Sign-in is invalid or expired ({exc}). Please sign in again."}), 401
            if admin and not is_admin(claims, token):
                return jsonify({"error": "Admin access required."}), 403
            g.user = claims   # let the route know who is calling (g is Flask's per-request storage)
            return fn(*args, **kwargs)
        return wrapper
    return deco
