"""Extraction into Sections and the Content Integrity rules (Story 2.2, AD-5, AD-6). No database needed."""

import asyncio
from pathlib import Path

import pytest

from app import extraction
from app.config import Settings
from app.extraction import integrity, text
from app.extraction.office import split_slides

TEST_DATA = Path(__file__).resolve().parents[2] / "test-data"
T = integrity.Thresholds()


def sample(name: str) -> bytes:
    return (TEST_DATA / name).read_bytes()


def run(name: str, file_type: str) -> tuple[extraction.Extracted, integrity.Verdict]:
    extracted = extraction.extract_sync(sample(name), file_type)
    return extracted, integrity.judge(extracted, T)


# --- Every test-data sample gives its documented outcome (test-data/README.md) ---


@pytest.mark.parametrize(
    ("name", "file_type", "outcome", "pages"),
    [
        ("photosynthesis-lecture.pdf", "pdf", "accepted", ()),
        ("integrity-warn.pdf", "pdf", "accepted_with_warning", (2, 4)),
        ("integrity-reject.pdf", "pdf", "rejected", ()),
        ("photosynthesis-lecture.pptx", "pptx", "accepted", ()),
        ("integrity-warn.pptx", "pptx", "accepted_with_warning", (2, 4)),
        ("integrity-reject.pptx", "pptx", "rejected", ()),
        ("photosynthesis-notes.docx", "docx", "accepted", ()),
        ("integrity-warn.docx", "docx", "accepted_with_warning", ()),
        ("integrity-reject.docx", "docx", "rejected", ()),
        ("photosynthesis-notes.md", "md", "accepted", ()),
        ("fotosyntese-notater.md", "md", "accepted", ()),
        ("integrity-warn.txt", "txt", "accepted_with_warning", ()),
        ("integrity-reject.txt", "txt", "rejected", ()),
    ],
)
def test_samples_give_their_documented_outcome(name, file_type, outcome, pages):
    _, verdict = run(name, file_type)
    assert verdict.outcome == outcome
    assert verdict.warning_pages == pages
    if outcome == "rejected":
        assert verdict.reason == "unreadable"


def test_pdf_has_one_section_per_page():
    extracted, _ = run("photosynthesis-lecture.pdf", "pdf")
    assert extracted.paged
    assert [s.label for s in extracted.sections] == [f"Page {n}" for n in range(1, 9)]
    assert "chloroplasts" in extracted.sections[0].text


def test_pdf_keeps_empty_pages_so_positions_match_page_numbers():
    extracted, _ = run("integrity-warn.pdf", "pdf")
    assert [s.label for s in extracted.sections] == [f"Page {n}" for n in range(1, 6)]
    assert extracted.sections[1].text == ""


def test_pptx_has_one_section_per_slide():
    extracted, _ = run("photosynthesis-lecture.pptx", "pptx")
    assert extracted.paged
    assert len(extracted.sections) == 8
    assert extracted.sections[0].label.startswith("Slide 1")
    assert "<!-- Slide number" not in extracted.sections[0].text


def test_slide_labels_use_the_title():
    markdown = "\n<!-- Slide number: 1 -->\n# Mitosis\nCells divide.\n\n<!-- Slide number: 2 -->\nNo title here."
    sections = split_slides(markdown)
    assert [s.label for s in sections] == ["Slide 1: Mitosis", "Slide 2"]
    assert sections[1].text == "No title here."


def test_docx_and_md_are_not_paged_and_split_at_about_500_words():
    for name, file_type in [("photosynthesis-notes.docx", "docx"), ("photosynthesis-notes.md", "md")]:
        extracted, _ = run(name, file_type)
        assert not extracted.paged
        assert len(extracted.sections) >= 2
        assert all(len(s.text.split()) <= text.TARGET_WORDS for s in extracted.sections)


@pytest.mark.parametrize(
    ("name", "file_type"),
    [
        ("integrity-reject-corrupt.pdf", "pdf"),
        ("integrity-warn.txt", "docx"),  # plain text with a .docx name
        ("integrity-warn.txt", "pptx"),
        ("photosynthesis-lecture.pdf", "docx"),
        ("notes-photo.png", "txt"),  # binary content with a .txt name
    ],
)
def test_corrupt_or_mismatched_files_are_unparseable(name, file_type):
    with pytest.raises(extraction.Unparseable):
        extraction.extract_sync(sample(name), file_type)


def test_extract_runs_in_a_thread():
    extracted = asyncio.run(extraction.extract(sample("integrity-warn.txt"), "txt"))
    assert extracted.sections[0].label == "Part 1"


# --- Splitting (AD-5) ---


def test_plain_text_is_packed_to_about_500_words_at_paragraph_breaks():
    paragraph = " ".join(["word"] * 120)
    sections = text.split_plain("\n\n".join([paragraph] * 10))  # 1,200 words
    assert [len(s.text.split()) for s in sections] == [480, 480, 240]
    assert [s.label for s in sections] == ["Part 1", "Part 2", "Part 3"]


def test_a_single_huge_paragraph_is_cut_at_500_words():
    sections = text.split_plain(" ".join(["word"] * 1100))
    assert [len(s.text.split()) for s in sections] == [500, 500, 100]


def test_markdown_splits_at_headings_and_labels_by_heading():
    body = " ".join(["word"] * 300)
    markdown = f"# Light\n{body}\n\n## Calvin cycle\n{body}\n\n## Short\nend"
    sections = text.split_markdown(markdown)
    assert [s.label for s in sections] == ["Light", "Calvin cycle"]
    assert sections[1].text.endswith("end")  # the short part is packed with the one before


def test_markdown_without_headings_uses_part_labels():
    assert text.split_markdown("Just a note.")[0].label == "Part 1"


def test_nul_characters_are_unparseable_and_windows_1252_text_is_read():
    with pytest.raises(extraction.Unparseable):
        text.decode(b"abc\x00def")
    assert text.decode("blåbær".encode("cp1252")) == "blåbær"
    assert text.decode("﻿hei".encode("utf-8")) == "hei"


# --- Integrity rules (AD-6) ---


def pages(*sizes: int) -> list[str]:
    return ["x" * size for size in sizes]


@pytest.mark.parametrize(
    ("sizes", "outcome", "warning"),
    [
        ((100, 100, 100, 100, 100), "accepted", ()),
        ((100, 100, 100, 100, 0), "accepted", ()),  # 80 % readable
        ((100, 100, 100, 0, 0), "accepted_with_warning", (4, 5)),  # 60 %
        ((100, 100, 100, 19, 0, 0, 0, 0, 0, 0), "accepted_with_warning", tuple(range(4, 11))),  # exactly 30 %
        ((300, 0, 0, 0), "rejected", ()),  # 25 %
        ((50, 50, 50), "rejected", ()),  # every page readable, but < 200 characters in total
        ((), "rejected", ()),
    ],
)
def test_paged_thresholds(sizes, outcome, warning):
    verdict = integrity.judge_paged(pages(*sizes), T)
    assert verdict.outcome == outcome
    assert verdict.warning_pages == warning


@pytest.mark.parametrize(
    ("chars", "outcome"),
    [(1000, "accepted"), (999, "accepted_with_warning"), (200, "accepted_with_warning"), (199, "rejected"), (0, "rejected")],
)
def test_text_thresholds(chars, outcome):
    assert integrity.judge_text(["x" * chars], T).outcome == outcome


def test_whitespace_does_not_count_as_readable():
    assert integrity.judge_text(["   \n\n " + "x" * 199 + "   "], T).outcome == "rejected"


def test_thresholds_come_from_the_settings():
    settings = Settings(_env_file=None, integrity_min_page_chars=5, integrity_text_accept_chars=500)
    thresholds = integrity.Thresholds.from_settings(settings)
    assert thresholds.min_page_chars == 5
    assert integrity.judge_text(["x" * 600], thresholds).outcome == "accepted"
