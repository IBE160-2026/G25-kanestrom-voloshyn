"""PDF: one Section per page with pdfplumber (AD-5). No OCR: a page without a text layer is empty (AD-6)."""

import io

import pdfplumber

from app.extraction.types import Extracted, ExtractedSection, Unparseable, clean


def extract(data: bytes) -> Extracted:
    if not data.lstrip().startswith(b"%PDF"):
        raise Unparseable("not a PDF")
    try:
        with pdfplumber.open(io.BytesIO(data)) as document:
            pages = [clean(page.extract_text() or "").strip() for page in document.pages]
    except Exception as exc:  # noqa: BLE001 -- any parser failure (corrupt, encrypted) means unparseable
        raise Unparseable(type(exc).__name__) from None
    return Extracted(
        paged=True,
        sections=tuple(ExtractedSection(label=f"Page {n}", text=page) for n, page in enumerate(pages, start=1)),
    )
