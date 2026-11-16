"""Rebuild the binary samples in test-data/ from the committed text files.

Run from the repo root:
    uv run --no-project --with fpdf2 --with python-docx --with python-pptx --with pillow python test-data/make_samples.py

Everything is generated from self-written text, so the output can be committed (CC0).
"""

from pathlib import Path
import re

from docx import Document
from fpdf import FPDF
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from pptx import Presentation
from pptx.util import Inches, Pt

HERE = Path(__file__).resolve().parent
NOTES = (HERE / "photosynthesis-notes.md").read_text(encoding="utf-8")
WARN_TEXT = (HERE / "integrity-warn.txt").read_text(encoding="utf-8").strip()
REJECT_TEXT = (HERE / "integrity-reject.txt").read_text(encoding="utf-8").strip()


def sections(markdown: str) -> list[tuple[str, str]]:
    """Split the notes into (heading, body) pairs on '## ' headings."""
    parts = re.split(r"^## ", markdown, flags=re.MULTILINE)[1:]
    out = []
    for part in parts:
        heading, _, body = part.partition("\n")
        body = re.sub(r"\*\*(.+?)\*\*", r"\1", body).strip()
        out.append((heading.strip(), body))
    return out


def latin1(text: str) -> str:
    # The PDF core fonts are Latin-1 only.
    return text.replace("–", "-").replace("—", "-").replace("’", "'").encode("latin-1", "replace").decode("latin-1")


def pdf(path: Path, pages: list[tuple[str, str] | None]) -> None:
    """One PDF page per entry; None makes a page with no text layer (unreadable, AD-6)."""
    doc = FPDF()
    doc.set_auto_page_break(False)
    for page in pages:
        doc.add_page()
        if page is None:
            continue
        heading, body = page
        doc.set_font("Helvetica", "B", 16)
        doc.multi_cell(0, 9, latin1(heading))
        doc.ln(2)
        doc.set_font("Helvetica", size=10)
        doc.multi_cell(0, 5, latin1(body.replace("|", " ")))
    doc.output(str(path))


def pptx(path: Path, slides: list[tuple[str, str] | None]) -> None:
    """One slide per entry; None makes an empty slide (unreadable, AD-6)."""
    deck = Presentation()
    for slide_text in slides:
        slide = deck.slides.add_slide(deck.slide_layouts[6])  # blank layout
        if slide_text is None:
            continue
        heading, body = slide_text
        box = slide.shapes.add_textbox(Inches(0.5), Inches(0.4), Inches(9), Inches(6.5)).text_frame
        box.word_wrap = True
        box.text = heading
        box.paragraphs[0].runs[0].font.size = Pt(28)
        for line in body.splitlines():
            if line.strip():
                para = box.add_paragraph()
                para.text = line.strip()
                para.font.size = Pt(12)
    deck.save(str(path))


def docx(path: Path, blocks: list[tuple[str, str]]) -> None:
    document = Document()
    for heading, body in blocks:
        if heading:
            document.add_heading(heading, level=2)
        for line in body.splitlines():
            if line.strip():
                document.add_paragraph(line.strip())
    document.save(str(path))


def photo(path: Path, lines: list[str], blur: float = 0.0, noise_box: bool = False) -> None:
    """A photo-like image of handwritten-style notes; the mock picks the outcome from the file name."""
    image = Image.new("RGB", (900, 600), (246, 241, 226))
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("arial.ttf", 30)
    except OSError:
        font = ImageFont.load_default()
    for row in range(14):
        draw.line([(40, 70 + row * 38), (860, 70 + row * 38)], fill=(190, 205, 225), width=1)
    for index, line in enumerate(lines):
        draw.text((55, 38 + index * 38), line, fill=(30, 40, 90), font=font)
    if noise_box:
        draw.rectangle([(450, 0), (900, 600)], fill=(120, 110, 100))
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(blur))
    image.save(path, optimize=True)


def main() -> None:
    notes = sections(NOTES)

    # Accepted: every page/slide readable.
    pdf(HERE / "photosynthesis-lecture.pdf", notes)
    pptx(HERE / "photosynthesis-lecture.pptx", notes)
    docx(HERE / "photosynthesis-notes.docx", notes)

    # Warn and continue: 30-80 % readable pages (3 of 5 = 60 %), or 200-999 characters.
    pdf(HERE / "integrity-warn.pdf", [notes[0], None, notes[1], None, notes[4]])
    pptx(HERE / "integrity-warn.pptx", [notes[0], None, notes[1], None, notes[4]])
    docx(HERE / "integrity-warn.docx", [("", WARN_TEXT)])

    # Reject: under 30 % readable pages (1 of 4 = 25 %), or under 200 characters.
    pdf(HERE / "integrity-reject.pdf", [notes[0], None, None, None])
    pptx(HERE / "integrity-reject.pptx", [None, None, None, ("Title only", "")])
    docx(HERE / "integrity-reject.docx", [("", REJECT_TEXT)])

    # Reject: wrong content for the extension (fails to parse).
    (HERE / "integrity-reject-corrupt.pdf").write_bytes(b"This is plain text, not a PDF.\n")

    # Images: the mock reads the outcome from the name (*-partial.*, *-unreadable.*), AD-4.
    lines = [
        "Photosynthesis - lecture 3 notes",
        "light reactions: thylakoid membrane",
        "  water split -> O2 + H+ (photolysis)",
        "  makes ATP + NADPH",
        "Calvin cycle: stroma",
        "  rubisco fixes CO2 onto RuBP",
        "  3 turns -> 1 G3P leaves the cycle",
        "limiting factors: light, CO2, temp",
        "C4 = space, CAM = time (night)",
    ]
    photo(HERE / "notes-photo.png", lines)
    photo(HERE / "notes-photo-partial.png", lines, noise_box=True)
    photo(HERE / "notes-photo-unreadable.png", lines, blur=9)


if __name__ == "__main__":
    main()
