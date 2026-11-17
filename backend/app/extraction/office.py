"""Word and PowerPoint through MarkItDown (AD-5).

- .pptx: one Section per slide, split on MarkItDown's `<!-- Slide number: N -->` markers.
- .docx: Markdown split at headings, then packed to about 500 words (`text.split_markdown`).

The format's own converter is called directly, so a file that isn't really a .docx or .pptx fails
to parse instead of falling back to plain text (AD-6).
"""

import io
import re

from markitdown import StreamInfo
from markitdown.converters import DocxConverter, PptxConverter

from app.extraction.text import split_markdown
from app.extraction.types import Extracted, ExtractedSection, Unparseable, clean

_SLIDE_MARKER = re.compile(r"^<!-- Slide number: (\d+) -->\s*$", re.MULTILINE)
_TITLE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
# Office files are ZIP containers.
_ZIP_MAGIC = b"PK\x03\x04"
_TITLE_MAX = 80


def _convert(converter, data: bytes, extension: str) -> str:
    if not data.startswith(_ZIP_MAGIC):
        raise Unparseable(f"not a {extension} file")
    try:
        result = converter.convert(io.BytesIO(data), StreamInfo(extension=extension))
    except Exception as exc:  # noqa: BLE001 -- any parser failure means unparseable
        raise Unparseable(type(exc).__name__) from None
    return clean(result.markdown or "")


def split_slides(markdown: str) -> tuple[ExtractedSection, ...]:
    """One Section per slide marker, labelled "Slide N" or "Slide N: Title" (AD-5)."""
    markers = list(_SLIDE_MARKER.finditer(markdown))
    sections = []
    for i, marker in enumerate(markers):
        end = markers[i + 1].start() if i + 1 < len(markers) else len(markdown)
        body = markdown[marker.end() : end].strip()
        number = int(marker.group(1))
        title = _TITLE.search(body)
        label = f"Slide {number}"
        if title and title.group(1).strip():
            label = f"{label}: {title.group(1).strip()[:_TITLE_MAX]}"
        sections.append(ExtractedSection(label=label, text=body))
    return tuple(sections)


def extract_pptx(data: bytes) -> Extracted:
    return Extracted(paged=True, sections=split_slides(_convert(PptxConverter(), data, ".pptx")))


def extract_docx(data: bytes) -> Extracted:
    return Extracted(paged=False, sections=split_markdown(_convert(DocxConverter(), data, ".docx")))
