"""Detect the Topics in each file (Story 2.6a, FR-22, AD-18, AD-21).

The pure parts (the target count, the mock, the repair, chunking) run without a database; the live path
uses a stubbed client, so nothing calls a provider. The job and list tests run through real uploads in
mock mode and need local Supabase, like test_materials.py.
"""

import asyncio
import json
import logging

import pytest

from app.config import Settings
from app.extraction import Extracted, ExtractedSection
from app.llm import DetectedTopics, Gateway, LLMOutputError, ProviderUnavailable, create_gateway
from app.llm.gateway import plan_chunks
from app.services import topics
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    bearer,
    client,
    created,
    db,
    gotrue,
    settings,
)
from tests.test_llm import StubClient
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    materials_of,
    stored_objects,
    student,
    upload,
    upload_and_wait,
    wait_for,
    wait_for_job,
)

MODEL = "test/text-model"
SECRET_LABEL = "Chlorophyll-secret-label"


def run(coro):
    return asyncio.run(coro)


def paged(count: int, text: str = "Light reactions and the Calvin cycle in chloroplasts.") -> Extracted:
    return Extracted(paged=True, sections=tuple(ExtractedSection(f"Page {n}", text) for n in range(1, count + 1)))


def words(*counts: int) -> Extracted:
    return Extracted(
        paged=False,
        sections=tuple(ExtractedSection(f"Part {n}", " ".join(["word"] * c)) for n, c in enumerate(counts, start=1)),
    )


def mock_gateway(**values) -> Gateway:
    return create_gateway(Settings(_env_file=None, llm_mode="mock", **values), "mock")


def live_gateway(*outcomes, **values) -> tuple[Gateway, StubClient]:
    stub = StubClient(*outcomes)
    gateway = Gateway(
        Settings(_env_file=None, llm_mode="live", openrouter_api_key="sk-test", llm_text_model=MODEL, **values),
        "live",
        client=stub,
    )
    return gateway, stub


def reply(*topics_: tuple[str, list[int]], group: str | None = None) -> str:
    return json.dumps({"topics": [{"label": label, "group_label": group, "sections": s} for label, s in topics_]})


def covered(drafts) -> list[int]:
    return sorted({position for draft in drafts for position in draft.sections})


# --- The target count (pure, server only) ---


@pytest.mark.parametrize(
    ("extracted", "pages", "target"),
    [
        (paged(1), 1, 3),
        (paged(15), 15, 3),
        (paged(16), 16, 4),
        (paged(40), 40, 8),
        (paged(500), 500, 100),
        (paged(600), 600, 100),
        # Words, not Sections: 2,600 words in 4 Sections are 6 pages.
        (words(650, 650, 650, 650), 6, 3),
        (words(5000, 5000, 3000), 26, 6),
        (words(10), 1, 3),
    ],
)
def test_target_count_is_clamp_ceil_pages_over_5(extracted, pages, target):
    assert topics.page_count(extracted) == pages
    assert topics.target_count(extracted) == target


# --- Mock mode ---


def test_mock_short_file_gets_three_topics_sharing_its_section():
    drafts = run(topics.detect(mock_gateway(), paged(1)))

    assert len(drafts) == 3
    assert [d.sections for d in drafts] == [(0,), (0,), (0,)]
    assert [d.label for d in drafts] == ["Topic 1: Page 1", "Topic 2: Page 1", "Topic 3: Page 1"]
    assert all(d.group_label is None for d in drafts)


def test_mock_typical_file_covers_each_section_once_in_order():
    drafts = run(topics.detect(mock_gateway(), paged(40)))

    assert len(drafts) == 8
    flat = [position for d in drafts for position in d.sections]
    assert flat == list(range(40))
    assert drafts[1].label == "Topic 2: Page 6"


def test_mock_ceiling_gives_100_grouped_topics_covering_everything():
    drafts = run(topics.detect(mock_gateway(), paged(600)))

    assert len(drafts) == 100
    assert covered(drafts) == list(range(600))
    assert [d.group_label for d in drafts[9:11]] == ["Part 1", "Part 2"]
    assert drafts[-1].group_label == "Part 10"


def test_mock_is_deterministic():
    first = run(topics.detect(mock_gateway(), paged(23)))
    second = run(topics.detect(mock_gateway(), paged(23)))

    assert first == second


# --- Repair of live output (stubbed client) ---


def test_live_gaps_drop_unknown_numbers_and_join_skipped_sections_to_the_topic_before():
    gateway, stub = live_gateway(reply(("Light", [1, 2]), ("Ghost", [9]), ("Calvin", [4, 99]), ("Late", [6])))

    drafts = run(topics.detect(gateway, paged(6)))

    assert len(stub.calls) == 1
    assert [d.label for d in drafts] == ["Light", "Calvin", "Late"]
    # S3 joins Light (before it); S5 joins Calvin; the unknown 9 and 99 are dropped.
    assert [d.sections for d in drafts] == [(0, 1, 2), (3, 4), (5,)]


def test_live_topics_are_ordered_by_their_first_section_and_leading_sections_join_the_first():
    gateway, _ = live_gateway(reply(("B", [4]), ("A", [2, 3])))

    drafts = run(topics.detect(gateway, paged(4)))

    assert [(d.label, d.sections) for d in drafts] == [("A", (0, 1, 2)), ("B", (3,))]


def test_live_reply_with_fewer_topics_than_the_target_is_kept_not_padded():
    gateway, _ = live_gateway(reply(("Everything", [1, 2])))

    drafts = run(topics.detect(gateway, paged(2)))

    assert [(d.label, d.sections) for d in drafts] == [("Everything", (0, 1))]


def test_live_request_asks_for_the_target_with_numbered_sections():
    gateway, stub = live_gateway(reply(("A", [1])))

    run(topics.detect(gateway, paged(40)))

    call = stub.calls[0]
    assert call["model"] == MODEL
    assert call["response_format"]["json_schema"]["name"] == "DetectedTopics"
    assert "exactly 8 topics" in call["messages"][0]["content"]
    assert "[S1]" in call["messages"][1]["content"] and "[S40]" in call["messages"][1]["content"]


def test_live_invalid_shape_is_retried_once_then_an_output_error():
    gateway, stub = live_gateway('{"topics": []}', '{"topics": [{"label": "A"}]}')

    with pytest.raises(LLMOutputError):
        run(topics.detect(gateway, paged(3)))
    assert len(stub.calls) == 2


def test_live_invalid_once_then_valid_succeeds():
    gateway, stub = live_gateway("not json", reply(("A", [1, 2, 3])))

    drafts = run(topics.detect(gateway, paged(3)))

    assert len(stub.calls) == 2
    assert drafts[0].sections == (0, 1, 2)


@pytest.mark.parametrize("blank", ["", "   "])
def test_a_blank_group_label_means_no_group(blank):
    gateway, stub = live_gateway(reply(("A", [1, 2]), group=blank))

    drafts = run(topics.detect(gateway, paged(2)))

    assert len(stub.calls) == 1
    assert drafts[0].group_label is None


def test_a_reply_naming_no_real_section_is_an_output_error():
    gateway, _ = live_gateway(reply(("A", [7]), ("B", [8])))

    with pytest.raises(LLMOutputError):
        run(topics.detect(gateway, paged(3)))


def test_repair_cuts_merged_topics_to_100_and_keeps_every_section_covered():
    merged = DetectedTopics.model_construct(
        topics=[
            DetectedTopics.model_validate({"topics": [{"label": f"T{n}", "group_label": None, "sections": [n]}]}).topics[0]
            for n in range(1, 151)
        ]
    )

    drafts = topics.repair(merged, 150)

    assert len(drafts) == 100
    assert covered(drafts) == list(range(150))
    assert drafts[-1].sections == tuple(range(99, 150))


def test_detection_logs_counts_but_no_labels_or_text(caplog):
    gateway, _ = live_gateway(reply((SECRET_LABEL, [1])))
    caplog.set_level(logging.INFO)

    run(topics.detect(gateway, paged(1, text="secret material text")))

    assert "detect_topics" in caplog.text
    assert SECRET_LABEL not in caplog.text
    assert "secret material text" not in caplog.text


# --- Chunking above the context budget ---


def test_plan_chunks_is_one_run_within_the_budget_and_splits_above_it():
    texts = ["x" * 4000] * 10  # 1,000 tokens each

    assert plan_chunks(texts, 10_000) == [(0, 10)]
    assert plan_chunks(texts, 3_000) == [(0, 3), (3, 6), (6, 9), (9, 10)]
    # A single Section over the budget is a run of its own.
    assert plan_chunks(["x" * 40_000, "y"], 1_000) == [(0, 1), (1, 2)]


def test_live_chunks_get_proportional_targets_and_merge_with_offsets():
    # 40 Sections of 1,000 tokens each, budget 20,000: two chunks of 20 Sections, 4 Topics asked of each.
    gateway, stub = live_gateway(
        reply(("A", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ("B", [11, 20])),
        reply(("C", [1, 5]), ("D", [6, 20])),
        llm_context_budget_tokens=20_000,
    )

    drafts = run(topics.detect(gateway, paged(40, text="x" * 4000)))

    assert len(stub.calls) == 2
    assert all("exactly 4 topics" in call["messages"][0]["content"] for call in stub.calls)
    # Each chunk is told the whole file's target, so grouping follows the file, not the chunk.
    assert all("The whole file gets 8 topics" in call["messages"][0]["content"] for call in stub.calls)
    assert all("{total}" not in call["messages"][0]["content"] for call in stub.calls)
    assert "[S21]" not in stub.calls[1]["messages"][1]["content"]
    assert [d.label for d in drafts] == ["A", "B", "C", "D"]
    assert drafts[2].sections[0] == 20  # C's S1 is the 21st Section
    assert covered(drafts) == list(range(40))


def test_live_chunk_numbers_outside_their_chunk_are_dropped_before_the_offset():
    # Two chunks of 20; the first reply names 25 and 21, which would otherwise land in the second chunk.
    gateway, _ = live_gateway(
        reply(("A", [1, 25]), ("Stray", [21])),
        reply(("C", [1, 20])),
        llm_context_budget_tokens=20_000,
    )

    drafts = run(topics.detect(gateway, paged(40, text="x" * 4000)))

    assert [d.label for d in drafts] == ["A", "C"]
    assert drafts[0].sections == tuple(range(20))
    assert drafts[1].sections == tuple(range(20, 40))


def test_mock_is_not_chunked():
    drafts = run(topics.detect(mock_gateway(llm_context_budget_tokens=1_000), paged(40, text="x" * 4000)))

    assert [position for d in drafts for position in d.sections] == list(range(40))


# --- In the processing job (needs local Supabase) ---


def topics_of(db, material_id: str) -> list[tuple[str, str | None, list[int]]]:
    rows = db.execute(
        """
        SELECT t.label, t.group_label, array_agg(s.position ORDER BY s.position)
        FROM topics t JOIN topic_sections ts ON ts.topic_id = t.id JOIN sections s ON s.id = ts.section_id
        WHERE t.material_id = %s GROUP BY t.id, t.label, t.group_label, t.position ORDER BY t.position
        """,
        (material_id,),
    ).fetchall()
    return [(label, group, list(positions)) for label, group, positions in rows]


def test_a_ready_file_has_topics_covering_every_section_and_the_list_returns_them(client, student, db):
    project_id = create_project(client, student["token"])

    material = upload_and_wait(client, student["token"], project_id, "photosynthesis-lecture.pdf")

    assert material["status"] == "ready"
    saved = topics_of(db, material["id"])
    # 8 pages: target 3, contiguous runs.
    assert [positions for _, _, positions in saved] == [[0, 1], [2, 3, 4], [5, 6, 7]]
    assert [t["label"] for t in material["topics"]] == [label for label, _, _ in saved]
    assert material["topics"][0]["label"] == "Topic 1: Page 1"
    assert [t["position"] for t in material["topics"]] == [0, 1, 2]
    assert set(material["topics"][0]) == {"id", "label", "group_label", "position"}
    origins = db.execute("SELECT DISTINCT origin FROM topics WHERE material_id = %s", (material["id"],)).fetchall()
    assert origins == [("auto",)]


def test_the_same_file_twice_gets_identical_topics_and_links(client, student, db):
    project_id = create_project(client, student["token"])

    first = upload_and_wait(client, student["token"], project_id, "photosynthesis-notes.md")
    second = upload_and_wait(client, student["token"], project_id, "photosynthesis-notes.md")

    assert topics_of(db, first["id"]) == topics_of(db, second["id"])
    assert len(topics_of(db, first["id"])) >= 3


def test_each_material_lists_its_own_topics(client, student, db):
    project_id = create_project(client, student["token"])
    upload_and_wait(client, student["token"], project_id, "photosynthesis-lecture.pdf")
    upload_and_wait(client, student["token"], project_id, "integrity-reject.pdf")
    upload_and_wait(client, student["token"], project_id, "photosynthesis-notes.md")

    listed = materials_of(client, student["token"], project_id)

    ready = [m for m in listed if m["status"] == "ready"]
    rejected = [m for m in listed if m["status"] == "rejected"]
    assert len(ready) == 2 and len(rejected) == 1
    counts = set()
    for material in ready:
        own = topics_of(db, material["id"])
        assert [t["label"] for t in material["topics"]] == [label for label, _, _ in own]
        ids = {str(r[0]) for r in db.execute("SELECT id FROM topics WHERE material_id = %s", (material["id"],))}
        assert {t["id"] for t in material["topics"]} == ids
        counts.add(db.execute("SELECT count(*) FROM sections WHERE material_id = %s", (material["id"],)).fetchone()[0])
    assert len(counts) == 2  # different Section counts
    assert rejected[0]["topics"] == []


def test_reopening_lists_the_same_topics_in_the_same_order(client, student):
    project_id = create_project(client, student["token"])
    material = upload_and_wait(client, student["token"], project_id, "photosynthesis-lecture.pdf")

    again = materials_of(client, student["token"], project_id)[0]

    assert again["topics"] == material["topics"]


def test_a_rejected_file_has_no_topics(client, student, db):
    project_id = create_project(client, student["token"])

    material = upload_and_wait(client, student["token"], project_id, "integrity-reject.pdf")

    assert material["status"] == "rejected"
    assert material["topics"] == []
    assert db.execute("SELECT count(*) FROM topics WHERE material_id = %s", (material["id"],)).fetchone()[0] == 0


def test_a_detection_failure_rejects_the_file_and_saves_nothing(client, student, db, monkeypatch):
    async def failing(self, sections, target):
        raise ProviderUnavailable("down")

    monkeypatch.setattr(Gateway, "detect_topics", failing)
    project_id = create_project(client, student["token"])

    material = upload_and_wait(client, student["token"], project_id, "photosynthesis-lecture.pdf")

    assert (material["status"], material["reject_reason"]) == ("rejected", "processing_failed")
    assert material["topics"] == []
    for table in ("sections", "topics"):
        count = db.execute(f"SELECT count(*) FROM {table} WHERE material_id = %s", (material["id"],)).fetchone()[0]
        assert count == 0, table
    job = db.execute("SELECT status, error_code FROM generation_jobs WHERE result_ref = %s", (material["id"],)).fetchone()
    assert job == ("failed", "processing_failed")
    wait_for(lambda: stored_objects(db, student["id"], project_id, material["id"]) == 0)


def test_a_file_removed_during_detection_saves_nothing(client, student, db, monkeypatch):
    real = Gateway.detect_topics

    async def remove_meanwhile(self, sections, target):
        db.execute(
            "UPDATE study_materials SET removed_at = now() WHERE status = 'processing' AND account_id = %s",
            (student["id"],),
        )
        return await real(self, sections, target)

    monkeypatch.setattr(Gateway, "detect_topics", remove_meanwhile)
    project_id = create_project(client, student["token"])
    response = upload(client, student["token"], project_id, "photosynthesis-lecture.pdf")
    assert response.status_code == 202, response.text
    body = response.json()

    assert wait_for_job(db, body["job_id"]) == "cancelled"
    material_id = body["material"]["id"]
    for table in ("sections", "topics"):
        count = db.execute(f"SELECT count(*) FROM {table} WHERE material_id = %s", (material_id,)).fetchone()[0]
        assert count == 0, table


def test_topic_tables_are_closed_to_the_browser_keys(db):
    for table in ("topics", "topic_sections"):
        row = db.execute(
            "SELECT has_table_privilege('anon', %s, 'SELECT'), has_table_privilege('authenticated', %s, 'SELECT')",
            (f"public.{table}", f"public.{table}"),
        ).fetchone()
        assert row == (False, False)


def test_context_budget_setting_defaults_to_100000():
    assert Settings(_env_file=None).llm_context_budget_tokens == 100_000
