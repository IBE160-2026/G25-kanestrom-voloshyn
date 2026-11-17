"""Content Integrity (AD-6): accept, accept with a warning, or reject. Pure and synchronous (AD-29).

| Input | Accept | Warn | Reject |
| --- | --- | --- | --- |
| PDF, .pptx (paged) | >= 80 % readable pages | 30-80 % | < 30 %, or < 200 characters in total |
| .docx, .txt, .md | >= 1,000 characters | 200-999 | < 200 |

A readable page has at least `min_page_chars` characters. Every number comes from the settings.
"""

from dataclasses import dataclass
from typing import Literal

from app.config import Settings
from app.extraction.types import Extracted

Outcome = Literal["accepted", "accepted_with_warning", "rejected"]


@dataclass(frozen=True)
class Thresholds:
    min_page_chars: int = 20
    paged_accept_ratio: float = 0.8
    paged_reject_ratio: float = 0.3
    min_total_chars: int = 200
    text_accept_chars: int = 1000

    @classmethod
    def from_settings(cls, settings: Settings) -> "Thresholds":
        return cls(
            min_page_chars=settings.integrity_min_page_chars,
            paged_accept_ratio=settings.integrity_paged_accept_ratio,
            paged_reject_ratio=settings.integrity_paged_reject_ratio,
            min_total_chars=settings.integrity_min_total_chars,
            text_accept_chars=settings.integrity_text_accept_chars,
        )


@dataclass(frozen=True)
class Verdict:
    outcome: Outcome
    # 'unreadable' when rejected; parse failures are judged before this ('unparseable').
    reason: str | None = None
    # 1-based pages or slides that couldn't be read, named with a warning.
    warning_pages: tuple[int, ...] = ()


ACCEPTED = Verdict("accepted")
UNREADABLE = Verdict("rejected", "unreadable")


def _chars(text: str) -> int:
    return len(text.strip())


def judge_paged(pages: list[str], t: Thresholds) -> Verdict:
    if not pages or sum(_chars(p) for p in pages) < t.min_total_chars:
        return UNREADABLE
    unreadable = tuple(n for n, page in enumerate(pages, start=1) if _chars(page) < t.min_page_chars)
    ratio = (len(pages) - len(unreadable)) / len(pages)
    if ratio < t.paged_reject_ratio:
        return UNREADABLE
    if ratio < t.paged_accept_ratio:
        return Verdict("accepted_with_warning", warning_pages=unreadable)
    return ACCEPTED


def judge_text(parts: list[str], t: Thresholds) -> Verdict:
    chars = sum(_chars(part) for part in parts)
    if chars < t.min_total_chars:
        return UNREADABLE
    if chars < t.text_accept_chars:
        return Verdict("accepted_with_warning")
    return ACCEPTED


def judge(extracted: Extracted, t: Thresholds) -> Verdict:
    texts = [section.text for section in extracted.sections]
    return judge_paged(texts, t) if extracted.paged else judge_text(texts, t)
