"""Turn an uploaded file into ordered Sections (AD-5). Blocking parsers run only via `asyncio.to_thread`.

`extract(data, file_type)` is the one entry point. It raises `Unparseable` for a corrupt, encrypted, or
mismatched file (AD-6). The integrity rules live in `integrity.py` as pure functions.
"""

import asyncio
from collections.abc import Callable

from app.extraction import office, pdf, text
from app.extraction.types import Extracted, ExtractedSection, Unparseable

__all__ = ["Extracted", "ExtractedSection", "Unparseable", "extract"]

_PARSERS: dict[str, Callable[[bytes], Extracted]] = {
    "pdf": pdf.extract,
    "pptx": office.extract_pptx,
    "docx": office.extract_docx,
    "md": text.extract_markdown,
    "txt": text.extract_plain,
}


def extract_sync(data: bytes, file_type: str) -> Extracted:
    try:
        parser = _PARSERS[file_type]
    except KeyError:
        raise ValueError(f"No parser for {file_type!r}") from None
    return parser(data)


async def extract(data: bytes, file_type: str) -> Extracted:
    """Parse the original off the event loop (AD-29)."""
    return await asyncio.to_thread(extract_sync, data, file_type)
