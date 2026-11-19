"""Content Integrity (AD-6): accept, accept with a warning, or reject. Pure and synchronous (AD-29).

| Input | Accept | Warn | Reject |
| --- | --- | --- | --- |
| PDF, .pptx (paged) | >= 80 % readable pages | 30-80 % | < 30 %, or < 200 characters in total |
| .docx, .txt, .md | >= 1,000 characters | 200-999 | < 200 |
| Image (JPG, PNG, HEIC) | legibility `readable` | `partial` | `unreadable`, or < 50 characters |
| Phone batch | every photo readable | some partial or unreadable (named) | every photo unreadable |

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
    min_image_chars: int = 50

    @classmethod
    def from_settings(cls, settings: Settings) -> "Thresholds":
        return cls(
            min_page_chars=settings.integrity_min_page_chars,
            paged_accept_ratio=settings.integrity_paged_accept_ratio,
            paged_reject_ratio=settings.integrity_paged_reject_ratio,
            min_total_chars=settings.integrity_min_total_chars,
            text_accept_chars=settings.integrity_text_accept_chars,
            min_image_chars=settings.integrity_min_image_chars,
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


def judge_image(legibility: str, text: str, t: Thresholds) -> Verdict:
    """A photo of notes from the vision model's legibility and its extracted text (FR-7, AD-6)."""
    if legibility == "unreadable" or _chars(text) < t.min_image_chars:
        return UNREADABLE
    if legibility == "partial":
        return Verdict("accepted_with_warning")
    return ACCEPTED


PhotoState = Literal["readable", "partial", "unreadable"]


def photo_state(legibility: str, text: str, t: Thresholds) -> PhotoState:
    """One photo, judged as a single image would be: `unreadable` or under the minimum characters is
    unreadable; `partial` is partial; anything else readable."""
    if legibility == "unreadable" or _chars(text) < t.min_image_chars:
        return "unreadable"
    return "partial" if legibility == "partial" else "readable"


def judge_batch(photos: list[tuple[str, str]], t: Thresholds) -> Verdict:
    """A phone batch (FR-21, AD-6 phone row) from each photo's (legibility, text), in page order: every
    photo readable accepts; every photo unreadable rejects; otherwise it is accepted with a warning
    naming the 1-based pages that were partial or unreadable."""
    states = [photo_state(legibility, text, t) for legibility, text in photos]
    if not states or all(state == "unreadable" for state in states):
        return UNREADABLE
    flagged = tuple(n for n, state in enumerate(states, start=1) if state != "readable")
    return Verdict("accepted_with_warning", warning_pages=flagged) if flagged else ACCEPTED
