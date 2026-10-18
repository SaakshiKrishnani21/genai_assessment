"""
PDF reports for Scuba Analyzer. Three report types:

  build_ai_report_pdf(data)          AI scores, feedback and corrections
  build_admin_report_pdf(data)       the admin's own scores and feedback
  build_comparison_report_pdf(data)  AI and admin scores side by side

Each function takes the same `data` dict app.py receives from the frontend and
returns the PDF as bytes. Fonts (IBM Plex) and the logo are bundled in the
backend/fonts and backend/assets folders.
"""

import math
import os
import re
from datetime import datetime

from fpdf import FPDF
from fpdf.enums import XPos, YPos

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, "assets", "logo-mark-light.png")

# ── Colours (same palette as the web app) ───────────────────────────────────
INK = (43, 27, 23)       # espresso: headings and main text
BODY = (58, 43, 38)      # paragraph text
MUTED = (118, 103, 96)   # labels and captions
LINE = (221, 211, 198)   # hairlines and borders
TRACK = (234, 227, 217)  # empty part of a bar
SAND = (244, 240, 234)   # callout background
PEACH = (236, 160, 135)  # AI scores
PEACH_TEXT = (154, 74, 50)  # darker peach, readable as text
PLUM = (92, 58, 65)      # admin scores
GOOD, WARN, BAD = (74, 107, 58), (154, 91, 18), (163, 42, 42)

DIMENSIONS = [("semantic", "Semantic"), ("stylistic", "Stylistic"), ("pragmatic", "Pragmatic")]


# ═════════════════════════════════════════════════════════════════════════════
# Small helpers
# ═════════════════════════════════════════════════════════════════════════════
def number(value):
    """Convert to float, or None if it isn't a number."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def show(value):
    """Format a score for display: 7.0 -> '7', 7.75 -> '7.75', missing -> '-'."""
    n = number(value)
    return "-" if n is None else f"{round(n, 2):g}"


def score_colour(score):
    n = number(score)
    if n is None or n < 5:
        return BAD
    return WARN if n < 7 else GOOD


def score_word(score):
    n = number(score)
    if n is None:
        return "Not available"
    if n >= 9:
        return "Excellent"
    if n >= 7:
        return "Good"
    return "Average" if n >= 5 else "Needs work"


def agreement(diff):
    """Returns (words, colour) describing how close the AI and admin scores are."""
    if diff is None:
        return "Not available", MUTED
    gap = abs(diff)
    if gap <= 1:
        return "Close agreement", GOOD
    return ("Moderate difference", WARN) if gap <= 2 else ("Significant difference", BAD)


def clean(text):
    """Make text safe to print: no control characters, no unsupported symbols
    (emoji become '?'), and no single 'word' too long to wrap."""
    text = "-" if text is None else str(text)
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", "", text.replace("\t", "    "))
    text = "".join(c if ord(c) <= 0xFF or 0x2000 <= ord(c) <= 0x206F else "?" for c in text)
    return re.sub(r"\S{45,}", lambda m: " ".join(m.group()[i:i + 45] for i in range(0, len(m.group()), 45)), text)


def student_name(data):
    return data.get("name") or data.get("student_name") or "Student"


# ═════════════════════════════════════════════════════════════════════════════
# The PDF page (header, footer and text styles)
# ═════════════════════════════════════════════════════════════════════════════
class Report(FPDF):
    def __init__(self, title):
        super().__init__(format="A4")
        self.title_text = title
        self.add_font("Sans", "", os.path.join(HERE, "fonts", "PlexSans-Regular.ttf"))
        self.add_font("Sans", "B", os.path.join(HERE, "fonts", "PlexSans-SemiBold.ttf"))
        self.add_font("Sans", "I", os.path.join(HERE, "fonts", "PlexSans-Italic.ttf"))
        self.add_font("Mono", "", os.path.join(HERE, "fonts", "PlexMono-Regular.ttf"))
        self.add_font("Mono", "B", os.path.join(HERE, "fonts", "PlexMono-Medium.ttf"))
        self.set_margins(18, 18, 18)
        self.set_auto_page_break(True, margin=22)
        self.alias_nb_pages()  # lets the footer say "Page 1 of 3"
        self.set_title(f"Scuba Analyzer - {title}")
        self.add_page()

    # -- text styles --
    def style(self, size=10, bold=False, italic=False, mono=False, colour=BODY):
        family = "Mono" if mono else "Sans"
        mark = "B" if bold else ("I" if italic and not mono else "")
        self.set_font(family, mark, size)
        self.set_text_color(*colour)

    def width(self):
        return self.w - self.l_margin - self.r_margin

    def need(self, height):
        """Start a new page if `height` mm would not fit on this one."""
        if self.get_y() + height > self.h - 22:
            self.add_page()

    def line_across(self, y):
        self.set_draw_color(*LINE)
        self.set_line_width(0.2)
        self.line(self.l_margin, y, self.w - self.r_margin, y)

    def multi_cell(self, w, h=None, text="", *args, **kwargs):
        kwargs.setdefault("align", "L")  # left-aligned (fpdf2 justifies by default)
        return super().multi_cell(w, h, text, *args, **kwargs)

    # -- page header and footer --
    def header(self):
        if self.page_no() == 1:  # big dark band with logo
            self.set_fill_color(*INK)
            self.rect(0, 0, self.w, 26, style="F")
            self.set_fill_color(*PEACH)
            self.rect(0, 26, self.w, 1, style="F")
            self.image(LOGO, x=18, y=5.5, h=15)
            self.style(10.5, bold=True, colour=SAND)
            self.set_char_spacing(1.6)
            self.set_xy(36, 9.4)
            self.cell(70, 7, "SCUBA ANALYZER")
            self.set_char_spacing(0)
            self.style(9.5, colour=(198, 180, 168))
            self.set_xy(self.w - 98, 9.8)
            self.cell(80, 6, self.title_text, align="R")
            self.set_y(38)
        else:  # small running header
            self.style(8.5, colour=MUTED)
            self.set_xy(18, 9)
            self.cell(90, 5, "Scuba Analyzer")
            self.cell(self.width() - 90, 5, self.title_text, align="R")
            self.line_across(15)
            self.set_y(22)

    def footer(self):
        self.set_y(-14)
        self.line_across(self.get_y())
        self.style(8, colour=MUTED)
        self.set_xy(18, self.get_y() + 2.5)
        self.cell(90, 4, "Scuba Analyzer")
        self.cell(self.width() - 90, 4, f"Page {self.page_no()} of {{nb}}", align="R")


# ═════════════════════════════════════════════════════════════════════════════
# Building blocks used by all three reports
# ═════════════════════════════════════════════════════════════════════════════
def title_block(pdf, title, details):
    """Big title, date, and a small table of (label, value, bold) details."""
    pdf.style(22, bold=True, colour=INK)
    pdf.cell(0, 11, clean(title), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.style(9.5, colour=MUTED)
    pdf.cell(0, 6, datetime.now().strftime("Generated %d %B %Y, %H:%M"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(4)
    for label, value, bold in details:
        if not value:
            continue
        y = pdf.get_y()
        pdf.style(9.5, colour=MUTED)
        pdf.cell(24, 5.6, label)
        pdf.style(10, bold=bold, colour=INK)
        pdf.set_xy(pdf.l_margin + 24, y)
        pdf.multi_cell(pdf.width() - 24, 5.6, clean(value), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)
    pdf.line_across(pdf.get_y())
    pdf.ln(5)


def section(pdf, title, right_text=None, right_colour=INK, keep=24):
    """Section heading with a rule under it. `keep` = space the section needs,
    so a heading is never left alone at the bottom of a page."""
    pdf.need(keep)
    pdf.ln(5)
    y = pdf.get_y()
    pdf.style(12.5, bold=True, colour=INK)
    pdf.cell(pdf.width() - 40, 7, clean(title))
    if right_text:
        pdf.style(11, bold=True, mono=True, colour=right_colour)
        pdf.set_xy(pdf.w - pdf.r_margin - 40, y)
        pdf.cell(40, 7, clean(right_text), align="R")
    pdf.line_across(y + 8.2)
    pdf.set_xy(pdf.l_margin, y + 11.5)


def sub_heading(pdf, text):
    pdf.need(18)
    pdf.style(10.5, bold=True, colour=INK)
    pdf.cell(0, 6.5, clean(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)


def paragraph(pdf, text, colour=BODY, italic=False, size=10):
    pdf.style(size, italic=italic, colour=colour)
    pdf.multi_cell(0, 5.4, clean(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)


def score_strip(pdf, cells):
    """A bordered strip of big numbers. Each cell is (label, value, colour, caption)."""
    height = 27
    pdf.need(height + 10)
    x, y, cell_w = pdf.l_margin, pdf.get_y(), pdf.width() / len(cells)
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.25)
    pdf.rect(x, y, pdf.width(), height)
    for i, (label, value, colour, caption) in enumerate(cells):
        left = x + i * cell_w + 5
        if i:
            pdf.line(left - 5, y + 4, left - 5, y + height - 4)
        pdf.style(9, colour=MUTED)
        pdf.set_xy(left, y + 4)
        pdf.cell(cell_w - 8, 4.5, clean(label))
        pdf.style(20, bold=True, mono=True, colour=PEACH_TEXT if colour == PEACH else colour)
        pdf.set_xy(left, y + 9.5)
        pdf.cell(cell_w - 8, 9, clean(value))
        pdf.style(9, colour=MUTED)
        pdf.set_xy(left, y + 19.5)
        pdf.cell(cell_w - 8, 4.5, clean(caption))
    pdf.set_y(y + height + 2)
    pdf.style(8.5, colour=MUTED)
    pdf.cell(0, 5, "All scores are out of 10.", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(3)


def callout(pdf, title, text, colour):
    """A shaded note with a coloured stripe on the left."""
    pad, line_h = 3.2, 5
    inner_w = pdf.width() - 1.2 - 2 * pad
    pdf.style(9.5)
    lines = pdf.multi_cell(inner_w, line_h, clean(text), dry_run=True, output="LINES")
    height = pad + 5.5 + len(lines) * line_h + pad
    pdf.need(height + 4)
    x, y = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(*SAND)
    pdf.rect(x, y, pdf.width(), height, style="F")
    pdf.set_fill_color(*colour)
    pdf.rect(x, y, 1.2, height, style="F")
    pdf.style(9.5, bold=True, colour=INK)
    pdf.set_xy(x + 1.2 + pad, y + pad)
    pdf.cell(inner_w, 5.5, clean(title))
    pdf.style(9.5)
    pdf.set_xy(x + 1.2 + pad, y + pad + 5.5)
    pdf.multi_cell(inner_w, line_h, clean(text), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_y(y + height + 4)


def warnings(pdf, data):
    """Notes for an off-topic essay or flagged AI-generated text."""
    if data.get("irrelevant"):
        callout(pdf, "Off-topic essay", "The essay did not address the assigned topic, so the AI scored it 0.", BAD)
    ai = data.get("ai_generated") or {}
    if ai.get("detected"):
        text = f"The detector estimates a {ai.get('confidence')}% likelihood that this text was AI-generated."
        callout(pdf, "AI-generated text flagged", f"{text} {ai.get('reason') or ''}".strip(), WARN)


def corrections_list(pdf, corrections):
    """Each correction: a peach stripe, then Original / Expected / Correction."""
    for item in corrections:
        pdf.need(26)
        top = pdf.get_y()
        for label, key, colour, mono in (("Original", "original_text", BAD, False),
                                         ("Expected", "expected", MUTED, False),
                                         ("Correction", "correction", INK, True)):
            y = pdf.get_y()
            pdf.style(8.5, colour=MUTED)
            pdf.set_xy(pdf.l_margin + 5, y)
            pdf.cell(22, 5, label)
            pdf.style(9.5, mono=mono, colour=colour)
            pdf.set_xy(pdf.l_margin + 27, y)
            pdf.multi_cell(pdf.width() - 27, 5, clean(item.get(key)), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_fill_color(*PEACH)
        pdf.rect(pdf.l_margin, top, 0.9, pdf.get_y() - top, style="F")
        pdf.ln(3)


def dimension_section(pdf, label, result):
    """One AI dimension: heading with its score, feedback, then corrections."""
    score = number(result.get("score"))
    section(pdf, label, right_text=f"{show(score)} / 10" if score is not None else None,
            right_colour=score_colour(score), keep=40)
    paragraph(pdf, result.get("feedback") or "No feedback recorded.")
    corrections = [c for c in result.get("corrections") or [] if isinstance(c, dict)]
    if corrections:
        sub_heading(pdf, "Corrections")
        corrections_list(pdf, corrections)
    else:
        paragraph(pdf, "No line-level corrections for this dimension.", colour=MUTED, italic=True, size=9.5)


def essay_section(pdf, data):
    if data.get("essay"):
        words = len(re.findall(r"\S+", str(data["essay"])))
        section(pdf, "Essay as submitted", right_text=f"{words} words", right_colour=MUTED)
        paragraph(pdf, data["essay"])


def reviewer_note(pdf, data):
    if (data.get("footer_note") or "").strip():
        section(pdf, "Reviewer's note")
        paragraph(pdf, data["footer_note"], italic=True)


# ═════════════════════════════════════════════════════════════════════════════
# Charts (plain rectangles, 0 to 10 scale)
# ═════════════════════════════════════════════════════════════════════════════
def draw_bar(pdf, x, y, width, value, colour, height=5.5):
    """A grey track with a coloured bar on top, and the value written after it."""
    value = min(number(value) or 0, 10)
    pdf.set_fill_color(*TRACK)
    pdf.rect(x, y, width, height, style="F")
    pdf.set_fill_color(*colour)
    pdf.rect(x, y, width * value / 10, height, style="F")
    pdf.style(8.5, bold=True, mono=True, colour=PEACH_TEXT if colour == PEACH else colour)
    pdf.set_xy(x + width * value / 10 + 1.5, y - 0.3)
    pdf.cell(11, 6, f"{value:g}")


def bar_chart(pdf, rows):
    """rows: (label, value, colour). One bar per row."""
    pdf.need(10 * len(rows) + 6)
    bars_x = pdf.l_margin + 30
    for label, value, colour in rows:
        y = pdf.get_y()
        pdf.style(9.5, bold=True, colour=INK)
        pdf.set_xy(pdf.l_margin, y + 1.2)
        pdf.cell(29, 6, clean(label))
        draw_bar(pdf, bars_x, y + 1.5, pdf.width() - 42, value, colour)
        pdf.set_y(y + 10)
    pdf.ln(3)


def grouped_chart(pdf, rows):
    """rows: (label, ai_value, admin_value). Two bars per row."""
    pdf.need(15 * len(rows) + 14)
    for i, (colour, text) in enumerate(((PEACH, "AI score"), (PLUM, "Admin score"))):
        x = pdf.l_margin + i * 46
        pdf.set_fill_color(*colour)
        pdf.rect(x, pdf.get_y() + 1.2, 4, 3, style="F")
        pdf.style(8.5, colour=MUTED)
        pdf.set_xy(x + 6, pdf.get_y())
        pdf.cell(38, 5.5, text)
    pdf.ln(8)
    bars_x = pdf.l_margin + 30
    for label, ai, admin in rows:
        y = pdf.get_y()
        pdf.style(9.5, bold=True, colour=INK)
        pdf.set_xy(pdf.l_margin, y + 3.5)
        pdf.cell(29, 6, clean(label))
        draw_bar(pdf, bars_x, y + 1.5, pdf.width() - 42, ai, PEACH, height=4.6)
        draw_bar(pdf, bars_x, y + 7.5, pdf.width() - 42, admin, PLUM, height=4.6)
        pdf.set_y(y + 15)
    pdf.ln(3)


# ── Spider graph ─────────────────────────────────────────────────────────
# A spider (radar) graph: one axis per dimension, scale 0 to 10, centre = 0.
# axis 0 points straight up and the others follow clockwise. It is drawn in small steps:
# grid -> shapes -> axis names -> legend.
def spider_point(cx, cy, size, i, n, fraction=1.0):
    """Where axis i (out of n) is, at `fraction` of the way from the centre to the edge."""
    angle = 2 * math.pi * i / n
    return cx + size * fraction * math.sin(angle), cy - size * fraction * math.cos(angle)


def spider_grid(pdf, cx, cy, radius, n):
    """The web behind the data: rings at 2, 4, 6, 8, 10, a line to each axis, and some scale numbers."""
    pdf.set_draw_color(*LINE)
    pdf.set_line_width(0.25)
    for fraction in (0.2, 0.4, 0.6, 0.8, 1.0):
        pdf.polygon([spider_point(cx, cy, radius, i, n, fraction) for i in range(n)], style="D")
    for i in range(n):
        pdf.line(cx, cy, *spider_point(cx, cy, radius, i, n))
    pdf.style(6.5, mono=True, colour=MUTED)
    for fraction in (0.2, 0.6, 1.0):
        pdf.set_xy(cx + 1, cy - radius * fraction - 1.8)
        pdf.cell(6, 3.5, f"{fraction * 10:g}")


def spider_shapes(pdf, cx, cy, radius, axes, series):
    """One see-through coloured shape per series, with a dot on every score."""
    n = len(axes)
    for _, colour, values in series:
        corners = []
        for i, (key, _) in enumerate(axes):
            score = min(max(number(values[key]), 0), 10)
            corners.append(spider_point(cx, cy, radius, i, n, score / 10))
        pdf.set_draw_color(*colour)
        pdf.set_fill_color(*colour)
        pdf.set_line_width(0.8)
        with pdf.local_context(fill_opacity=0.22):
            pdf.polygon(corners, style="DF")
        for x, y in corners:
            pdf.ellipse(x - 1.1, y - 1.1, 2.2, 2.2, style="F")
    pdf.set_line_width(0.2)


def spider_labels(pdf, cx, cy, radius, axes, series):
    """The axis names with the scores under them: above the top axis, beside the others."""
    n = len(axes)
    for i, (key, label) in enumerate(axes):
        tip_x, tip_y = spider_point(cx, cy, radius, i, n)
        sideways = math.sin(2 * math.pi * i / n)        # -1 = left, +1 = right
        upwards = -math.cos(2 * math.pi * i / n)        # -1 = top, +1 = bottom
        if upwards < -0.9:                              # the top axis: label sits above its tip
            centre_x, top = tip_x, tip_y - 12
        else:                                           # the others: label sits beside its tip
            centre_x, top = tip_x + sideways * 21, tip_y + upwards * 4 - 3
        scores = "  ".join(f"{name.split()[0]} {number(values[key]):g}" for name, _, values in series)
        pdf.style(9.5, bold=True, colour=INK)
        pdf.set_xy(centre_x - 22, top)
        pdf.cell(44, 5, clean(label), align="C")
        pdf.style(8, mono=True, colour=MUTED)
        pdf.set_xy(centre_x - 22, top + 5)
        pdf.cell(44, 4.5, scores, align="C")


def spider_legend(pdf, cx, y, series):
    """A coloured square and a name for each series, centred under the graph."""
    widths = [30 + 3 * len(name) for name, _, _ in series]
    x = cx - sum(widths) / 2
    for (name, colour, _), width in zip(series, widths):
        pdf.set_fill_color(*colour)
        pdf.rect(x, y + 1.2, 4, 3, style="F")
        pdf.style(8.5, colour=MUTED)
        pdf.set_xy(x + 6, y)
        pdf.cell(width - 12, 5.5, clean(name))
        x += width
    pdf.set_xy(pdf.l_margin, y + 9)


def spider_chart(pdf, series, radius=34):
    """Draws the spider graph at the current position on the page.
    series: a list of (name, colour, {dimension: score}); two series are drawn on top of each other.
    Needs at least 3 dimensions with a score in every series, otherwise nothing is drawn."""
    axes = [(key, label) for key, label in DIMENSIONS
            if all(number(values.get(key)) is not None for _, _, values in series)]
    if len(axes) < 3 or not series:
        return
    n = len(axes)
    below = radius * max(-math.cos(2 * math.pi * i / n) for i in range(n))   # how far the lowest axis reaches under the centre
    pdf.need(radius + below + 40)                        # start a new page if there is not enough room
    cx = pdf.l_margin + pdf.width() / 2
    cy = pdf.get_y() + radius + 14                       # 14 mm of room above for the top label

    spider_grid(pdf, cx, cy, radius, n)
    spider_shapes(pdf, cx, cy, radius, axes, series)
    spider_labels(pdf, cx, cy, radius, axes, series)
    spider_legend(pdf, cx, cy + below + 14, series)


def difference_table(pdf, rows):
    """rows: (label, ai, admin). Shows the gap and a plain-words verdict."""
    pdf.need(9 * (len(rows) + 1) + 4)
    widths = [44, 26, 26, 30, pdf.width() - 126]
    pdf.style(9, bold=True, colour=INK)
    pdf.set_fill_color(*TRACK)
    for w, heading in zip(widths, ["Dimension", "AI", "Admin", "Difference", "Agreement"]):
        pdf.cell(w, 8, "  " + heading, fill=True)
    pdf.ln(8)
    for label, ai, admin in rows:
        diff = admin - ai
        words, colour = agreement(diff)
        pdf.style(9.5, bold=True, colour=INK)
        pdf.cell(widths[0], 8.5, "  " + clean(label))
        pdf.style(9.5, mono=True, colour=PEACH_TEXT)
        pdf.cell(widths[1], 8.5, f"  {show(ai)}")
        pdf.style(9.5, mono=True, colour=PLUM)
        pdf.cell(widths[2], 8.5, f"  {show(admin)}")
        pdf.style(9.5, bold=True, mono=True, colour=colour)
        pdf.cell(widths[3], 8.5, f"  {diff:+.2f}")
        pdf.style(9.5)
        pdf.cell(widths[4], 8.5, "  " + words, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.line_across(pdf.get_y())
    pdf.ln(3)


# ═════════════════════════════════════════════════════════════════════════════
# The three reports
# ═════════════════════════════════════════════════════════════════════════════
def build_ai_report_pdf(data: dict) -> bytes:
    pdf = Report("AI evaluation report")
    title_block(pdf, "AI evaluation report", [
        ("Student", student_name(data), False),
        ("Domain", data.get("domain"), False),
        ("Topic", data.get("topic"), True),
    ])

    average = data.get("avg_score")
    cells = [("Overall", show(average), score_colour(average), score_word(average))]
    for key, label in DIMENSIONS:
        score = (data.get(key) or {}).get("score")
        cells.append((label, show(score), score_colour(score), score_word(score)))
    score_strip(pdf, cells)
    warnings(pdf, data)

    section(pdf, "Score breakdown", keep=80)
    bar_chart(pdf, [(label, (data.get(key) or {}).get("score"), score_colour((data.get(key) or {}).get("score")))
                    for key, label in DIMENSIONS] + [("Overall", average, PEACH)])
    section(pdf, "Spider graph", keep=100)
    spider_chart(pdf, [("AI score", PEACH, {key: (data.get(key) or {}).get("score") for key, _ in DIMENSIONS})])
    for key, label in DIMENSIONS:
        dimension_section(pdf, label, data.get(key) or {})
    if data.get("overall_feedback"):
        section(pdf, "Overall feedback")
        paragraph(pdf, data["overall_feedback"])
    essay_section(pdf, data)
    return bytes(pdf.output())


def build_admin_report_pdf(data: dict) -> bytes:
    pdf = Report("Admin review report")
    title_block(pdf, "Admin review report", [
        ("Student", student_name(data), False),
        ("Reviewer", data.get("admin_name") or data.get("reviewer"), False),
        ("Domain", data.get("domain"), False),
        ("Topic", data.get("topic"), True),
    ])

    overall = data.get("admin_score")
    scores = data.get("admin_dims") or {}
    cells = [("Admin overall", show(overall), PLUM, score_word(overall))]
    cells += [(label, show(scores.get(key)), score_colour(scores.get(key)), score_word(scores.get(key)))
              for key, label in DIMENSIONS if number(scores.get(key)) is not None]
    score_strip(pdf, cells)

    section(pdf, "Score breakdown", keep=80)
    bar_chart(pdf, [(label, scores.get(key), score_colour(scores.get(key)))
                    for key, label in DIMENSIONS if number(scores.get(key)) is not None] + [("Overall", overall, PLUM)])
    if all(number(scores.get(key)) is not None for key, _ in DIMENSIONS):
        section(pdf, "Spider graph", keep=100)
        spider_chart(pdf, [("Admin score", PLUM, scores)])
    section(pdf, "Reviewer feedback")
    paragraph(pdf, data.get("admin_feedback") or "No feedback recorded.")
    reviewer_note(pdf, data)
    essay_section(pdf, data)
    return bytes(pdf.output())


def build_comparison_report_pdf(data: dict) -> bytes:
    pdf = Report("AI and admin comparison")
    title_block(pdf, "AI and admin comparison", [
        ("Student", student_name(data), False),
        ("Domain", data.get("domain"), False),
        ("Topic", data.get("topic"), True),
    ])

    ai, admin = number(data.get("avg_score")), number(data.get("admin_score"))
    diff = admin - ai if ai is not None and admin is not None else None
    words, colour = agreement(diff)
    score_strip(pdf, [
        ("AI score", show(ai), PEACH, score_word(ai)),
        ("Admin score", show(admin), PLUM, score_word(admin)),
        ("Difference (admin minus AI)", f"{diff:+.2f}" if diff is not None else "-", colour, words),
    ])
    warnings(pdf, data)

    # Per-dimension comparison needs both the AI and the admin dimension scores.
    ai_dims = {key: number((data.get(key) or {}).get("score")) for key, _ in DIMENSIONS}
    admin_dims = {key: number((data.get("admin_dims") or {}).get(key)) for key, _ in DIMENSIONS}
    if None not in ai_dims.values() and None not in admin_dims.values():
        rows = [(label, ai_dims[key], admin_dims[key]) for key, label in DIMENSIONS] + [("Overall", ai, admin)]
        section(pdf, "Dimension by dimension", keep=96)
        grouped_chart(pdf, rows)
        section(pdf, "Spider graph", keep=100)
        spider_chart(pdf, [("AI score", PEACH, ai_dims), ("Admin score", PLUM, admin_dims)])
        section(pdf, "Where the two scores differ", keep=66)
        difference_table(pdf, rows)
    else:  # older reviews only have an overall admin score
        section(pdf, "AI and admin overall", keep=50)
        bar_chart(pdf, [("AI score", ai, PEACH), ("Admin score", admin, PLUM)])

    section(pdf, "Feedback")
    for key, label in DIMENSIONS:
        result = data.get(key) or {}
        if result.get("feedback"):
            sub_heading(pdf, f"AI, {label.lower()} ({show(result.get('score'))} / 10)")
            paragraph(pdf, result["feedback"])
    if data.get("overall_feedback"):
        sub_heading(pdf, "AI overall feedback")
        paragraph(pdf, data["overall_feedback"])
    sub_heading(pdf, "Admin feedback")
    paragraph(pdf, data.get("admin_feedback") or "No feedback recorded.")
    reviewer_note(pdf, data)
    essay_section(pdf, data)
    return bytes(pdf.output())