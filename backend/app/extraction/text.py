"""Plain text and Markdown into Sections of about 500 words (AD-5).

- .md (and .docx after MarkItDown): split at headings, then pack small parts together and split
  large ones, to about `TARGET_WORDS` words each.
- .txt: chunks of about `TARGET_WORDS` words, at paragraph breaks where possible.

Pure functions; only `extract_*` decode bytes.
"""

import re

from app.extraction.types import Extracted, ExtractedSection, Unparseable, clean

TARGET_WORDS = 500
_HEADING = re.compile(r"^#{1,6}\s+\S")
_HEADING_TEXT = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_LABEL_MAX = 80


def decode(data: bytes) -> str:
    """UTF-8 (with or without BOM), else Windows-1252. Binary content is unparseable (AD-6)."""
    if b"\x00" in data:
        raise Unparseable("binary content")
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    try:
        return data.decode("cp1252")
    except UnicodeDecodeError:
        raise Unparseable("not text") from None


def _words(text: str) -> int:
    return len(text.split())


def _split_long(paragraph: str) -> list[str]:
    """A paragraph over the target, cut into pieces of TARGET_WORDS words."""
    words = paragraph.split()
    return [" ".join(words[i : i + TARGET_WORDS]) for i in range(0, len(words), TARGET_WORDS)]


def _pack(parts: list[str], separator: str = "\n\n") -> list[str]:
    """Join consecutive parts while the result stays within the target; split parts that are too long."""
    chunks: list[str] = []
    current: list[str] = []
    count = 0
    for part in parts:
        part = part.strip()
        if not part:
            continue
        size = _words(part)
        if size > TARGET_WORDS:
            if current:
                chunks.append(separator.join(current))
                current, count = [], 0
            pieces = _pack(_PARAGRAPH_BREAK.split(part)) if _PARAGRAPH_BREAK.search(part) else _split_long(part)
            chunks.extend(pieces)
            continue
        if current and count + size > TARGET_WORDS:
            chunks.append(separator.join(current))
            current, count = [], 0
        current.append(part)
        count += size
    if current:
        chunks.append(separator.join(current))
    return chunks


def _blocks_at_headings(markdown: str) -> list[str]:
    blocks: list[list[str]] = [[]]
    for line in markdown.splitlines():
        if _HEADING.match(line) and any(existing.strip() for existing in blocks[-1]):
            blocks.append([])
        blocks[-1].append(line)
    return ["\n".join(block).strip() for block in blocks if "\n".join(block).strip()]


def _label(chunk: str, number: int) -> str:
    first = chunk.lstrip().splitlines()[0] if chunk.strip() else ""
    heading = _HEADING_TEXT.match(first)
    if heading:
        return heading.group(1)[:_LABEL_MAX]
    return f"Part {number}"


def _sections(chunks: list[str]) -> tuple[ExtractedSection, ...]:
    return tuple(ExtractedSection(label=_label(chunk, n), text=chunk) for n, chunk in enumerate(chunks, start=1))


def split_markdown(markdown: str) -> tuple[ExtractedSection, ...]:
    """Split at headings, then pack to about 500 words; a part starting with a heading is labelled by it."""
    return _sections(_pack(_blocks_at_headings(clean(markdown))))


def split_plain(text: str) -> tuple[ExtractedSection, ...]:
    """Chunks of about 500 words, at paragraph breaks where possible, labelled "Part n"."""
    chunks = _pack(_PARAGRAPH_BREAK.split(clean(text)))
    return tuple(ExtractedSection(label=f"Part {n}", text=chunk) for n, chunk in enumerate(chunks, start=1))


def extract_markdown(data: bytes) -> Extracted:
    return Extracted(paged=False, sections=split_markdown(decode(data)))


def extract_plain(data: bytes) -> Extracted:
    return Extracted(paged=False, sections=split_plain(decode(data)))
