"""Mistake Review: starting a round, the `review_round` job, and clearing Mistakes in review (Stories 3.4 +
3.5, FR-17, FR-18, AD-9, AD-10, AD-11, AD-20). Mistakes come from wrong answers to Quizzes inserted
straight into the database (test_quiz_answers.py); the job runs in mock mode, with `LLM_MOCK_DELAY_MS`
holding each step so progress and cancel can be observed. Needs local Supabase.
"""

import random
import time
import uuid

import psycopg

import pytest
from fastapi.testclient import TestClient

from app.llm import Gateway, LLMOutputError, PracticeDraft, PracticeTarget, ProviderUnavailable
from app.main import create_app
from app.services import mistakes, review
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    assert_error,
    bearer,
    client,
    created,
    db,
    gotrue,
    settings,
    sign_up,
)
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    student,
    wait_for,
    wait_for_job,
)
from tests.test_mistakes import outstanding, remove, run
from tests.test_quiz_answers import OPTIONS, answer, insert_quiz

DELAY_MS = 600
TEXTS = {option["id"]: option["text"] for option in OPTIONS}


# --- Helpers ---


def make_mistakes(client, db, student, project: str, n: int, file_name: str = "lecture.pdf") -> tuple[list[str], str]:
    """`n` outstanding Mistakes, oldest first: each Question's correct option is "b" (Beta) and the wrong
    answer was "a" (Alpha). Returns ([mistake_id, ...], material_id)."""
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, n=n, correct="b", file_name=file_name)
    for question_id in question_ids:
        assert answer(client, student["token"], project, quiz_id, question_id, "a").status_code == 200
    rows = db.execute(
        "SELECT id::text FROM mistakes WHERE quiz_question_id = ANY(%s::uuid[]) ORDER BY created_at, id",
        (question_ids,),
    ).fetchall()
    return [row[0] for row in rows], material_id


def start(client, token: str, project: str):
    return client.post(f"/api/projects/{project}/review-rounds", headers=bearer(token))


def started(response) -> tuple[str, str]:
    assert response.status_code == 202, response.text
    body = response.json()
    assert set(body) == {"job_id", "round_id"}
    return body["job_id"], body["round_id"]


def get_round(client, token: str, project: str, round_id: str):
    return client.get(f"/api/projects/{project}/review-rounds/{round_id}", headers=bearer(token))


def round_body(client, token: str, project: str, round_id: str) -> dict:
    response = get_round(client, token, project, round_id)
    assert response.status_code == 200, response.text
    return response.json()


def answer_item(client, token: str, project: str, round_id: str, item_id: str, option_id):
    return client.post(
        f"/api/projects/{project}/review-rounds/{round_id}/items/{item_id}/answer",
        json={"option_id": option_id},
        headers=bearer(token),
    )


def full_round(client, db, student, project: str) -> tuple[str, dict]:
    """Start a round, wait for its job, and return (round_id, body)."""
    job_id, round_id = started(start(client, student["token"], project))
    assert wait_for_job(db, job_id) == "completed"
    return round_id, round_body(client, student["token"], project, round_id)


def key_of(db, item_id: str) -> str:
    return db.execute("SELECT correct_option_id FROM practice_questions WHERE id = %s", (item_id,)).fetchone()[0]


def wrong_of(db, item_id: str) -> str:
    return next(option for option in "abcd" if option != key_of(db, item_id))


def item_mistakes(db, item_ids: list[str]) -> list[str]:
    return [
        db.execute("SELECT mistake_id::text FROM practice_questions WHERE id = %s", (item_id,)).fetchone()[0]
        for item_id in item_ids
    ]


def job_row(db, job_id: str) -> tuple:
    return db.execute(
        "SELECT status, progress_step, error_code, result_ref FROM generation_jobs WHERE id = %s", (job_id,)
    ).fetchone()


def items_in(db, round_id: str) -> int:
    return db.execute("SELECT count(*) FROM round_items WHERE round_id = %s", (round_id,)).fetchone()[0]


def mistakes_in(db, project: str) -> int:
    return db.execute("SELECT count(*) FROM mistakes WHERE project_id = %s", (project,)).fetchone()[0]


class CountingPractice:
    """Counts `generate_practice` calls and their targets, delegating to the mock (or to `replace`)."""

    def __init__(self, monkeypatch, replace=None) -> None:
        self.calls: list[list[PracticeTarget]] = []
        real = Gateway.generate_practice

        async def counted(gateway, targets):
            self.calls.append(list(targets))
            if replace is not None:
                return await replace(gateway, targets)
            return await real(gateway, targets)

        monkeypatch.setattr(Gateway, "generate_practice", counted)


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


@pytest.fixture
def slow(settings):
    """A client whose mock tasks and steps each take `DELAY_MS`."""
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": DELAY_MS})), backend_options=LOOP) as c:
        yield c


# --- Start (3.4) ---


def test_a_round_of_three_outstanding_mistakes_saves_three_items_in_age_order(client, db, student, project):
    mistake_ids, material_id = make_mistakes(client, db, student, project, 3)

    job_id, round_id = started(start(client, student["token"], project))

    assert wait_for_job(db, job_id) == "completed"
    assert job_row(db, job_id) == ("completed", None, None, uuid.UUID(round_id))
    response = get_round(client, student["token"], project, round_id)
    body = response.json()
    assert (body["id"], body["total"], body["cleared_count"], body["remaining_outstanding"]) == (round_id, 3, 0, 3)
    assert [item["position"] for item in body["items"]] == [0, 1, 2]
    assert item_mistakes(db, [item["id"] for item in body["items"]]) == mistake_ids
    for position, item in enumerate(body["items"]):
        assert set(item) == {"id", "position", "question", "options", "context", "file_removed", "from_original",
                             "answer"}
        assert item["answer"] is None
        assert item["from_original"] is False
        assert item["file_removed"] is False
        assert [o["id"] for o in item["options"]] == ["a", "b", "c", "d"]
        assert item["context"] == {
            "question": f"Question {position + 1}?",
            "earlier_answer_text": "Alpha",
            "correct_text": None,
        }
    # The answer key, explanation, and sources stay hidden until answered (AD-9).
    raw = response.text
    assert "correct_option_id" not in raw and "explanation" not in raw and "lecture.pdf" not in raw
    rows = db.execute(
        """
        SELECT pq.from_original, pq.material_ids::text[], cardinality(pq.source_section_ids), pq.account_id::text
        FROM round_items ri JOIN practice_questions pq ON pq.id = ri.practice_question_id
        WHERE ri.round_id = %s
        """,
        (round_id,),
    ).fetchall()
    assert rows == [(False, [material_id], 1, student["id"])] * 3
    saved = db.execute("SELECT account_id::text, project_id::text, job_id::text FROM review_rounds WHERE id = %s",
                       (round_id,)).fetchone()
    assert saved == (student["id"], project, job_id)


def test_the_jobs_list_shows_the_finished_review_round_with_its_round(client, db, student, project):
    make_mistakes(client, db, student, project, 1)
    job_id, round_id = started(start(client, student["token"], project))
    assert wait_for_job(db, job_id) == "completed"

    listed = client.get(f"/api/projects/{project}/jobs", headers=bearer(student["token"])).json()

    assert [(j["id"], j["kind"], j["status"], j["result_ref"]) for j in listed if j["kind"] == "review_round"] == [
        (job_id, "review_round", "completed", round_id)
    ]


def test_with_no_outstanding_mistakes_nothing_is_queued(client, db, student, project):
    response = start(client, student["token"], project)

    assert_error(response, 422, "insufficient_material")
    assert db.execute("SELECT count(*) FROM generation_jobs WHERE project_id = %s", (project,)).fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM review_rounds WHERE project_id = %s", (project,)).fetchone()[0] == 0


def test_a_second_start_while_one_runs_is_refused(slow, db, student):
    project = create_project(slow, student["token"])
    make_mistakes(slow, db, student, project, 2)
    job_id, _ = started(start(slow, student["token"], project))

    assert_error(start(slow, student["token"], project), 409, "review_in_progress")

    assert wait_for_job(db, job_id) == "completed"
    assert db.execute("SELECT count(*) FROM review_rounds WHERE project_id = %s", (project,)).fetchone()[0] == 1
    # Once it has finished, a new round may start.
    second, _ = started(start(slow, student["token"], project))
    assert wait_for_job(db, second) == "completed"


def test_the_index_allows_one_active_review_round_per_project(client, db, student, project):
    make_mistakes(client, db, student, project, 1)
    db.execute(
        "INSERT INTO generation_jobs (account_id, project_id, kind, status) VALUES (%s, %s, 'review_round', 'running')",
        (student["id"], project),
    )

    assert_error(start(client, student["token"], project), 409, "review_in_progress")
    # Another kind is not limited by it.
    db.execute(
        "INSERT INTO generation_jobs (account_id, project_id, kind, status) VALUES (%s, %s, 'quiz', 'running')",
        (student["id"], project),
    )
    db.execute("UPDATE generation_jobs SET status = 'failed' WHERE project_id = %s", (project,))


def test_over_20_outstanding_the_20_oldest_are_taken(client, db, student, project):
    first, _ = make_mistakes(client, db, student, project, 20)
    second, _ = make_mistakes(client, db, student, project, 5)

    round_id, body = full_round(client, db, student, project)

    assert body["total"] == 20
    assert item_mistakes(db, [item["id"] for item in body["items"]]) == first
    assert body["remaining_outstanding"] == 25
    assert not set(second) & set(item_mistakes(db, [item["id"] for item in body["items"]]))


def test_an_unanswered_practice_question_moves_into_the_next_round(client, db, student, project, monkeypatch):
    make_mistakes(client, db, student, project, 3)
    _, first = full_round(client, db, student, project)
    counting = CountingPractice(monkeypatch)

    _, second = full_round(client, db, student, project)

    assert [item["id"] for item in second["items"]] == [item["id"] for item in first["items"]]
    assert counting.calls == []
    count = db.execute(
        "SELECT count(*) FROM practice_questions pq JOIN mistakes m ON m.id = pq.mistake_id WHERE m.project_id = %s",
        (project,),
    ).fetchone()[0]
    assert count == 3


def test_a_removed_file_is_practised_from_the_original_question_with_no_model_call(client, db, student, project,
                                                                                  monkeypatch):
    mistake_ids, material_id = make_mistakes(client, db, student, project, 2)
    assert remove(client, student["token"], project, material_id, withdraw=False).status_code == 204
    counting = CountingPractice(monkeypatch)

    round_id, body = full_round(client, db, student, project)

    assert counting.calls == []
    assert body["total"] == 2
    for position, item in enumerate(body["items"]):
        assert item["file_removed"] is True
        assert item["question"] == f"Question {position + 1}?"
        assert sorted(o["text"] for o in item["options"]) == sorted(TEXTS.values())
    rows = db.execute(
        """
        SELECT pq.from_original, pq.options, pq.correct_option_id, pq.explanation
        FROM round_items ri JOIN practice_questions pq ON pq.id = ri.practice_question_id
        WHERE ri.round_id = %s ORDER BY ri.position
        """,
        (round_id,),
    ).fetchall()
    for position, (from_original, options, correct, explanation) in enumerate(rows):
        assert from_original is True
        assert {o["id"]: o["text"] for o in options}[correct] == "Beta"
        assert explanation == f"Because {position + 1}."

    # It clears normally on a correct answer.
    item = body["items"][0]
    answered = answer_item(client, student["token"], project, round_id, item["id"], key_of(db, item["id"])).json()
    assert answered["cleared"] is True
    assert answered["answer"]["sources"] == [{"label": "lecture.pdf · Page 1"}]


def test_a_mix_sends_only_live_mistakes_to_the_model(client, db, student, project, monkeypatch):
    removed_ids, removed_material = make_mistakes(client, db, student, project, 1, file_name="old.pdf")
    live_ids, _ = make_mistakes(client, db, student, project, 2, file_name="new.pdf")
    assert remove(client, student["token"], project, removed_material, withdraw=False).status_code == 204
    counting = CountingPractice(monkeypatch)

    _, body = full_round(client, db, student, project)

    assert len(counting.calls) == 1
    assert [str(target.mistake_id) for target in counting.calls[0]] == live_ids
    assert item_mistakes(db, [item["id"] for item in body["items"]]) == removed_ids + live_ids
    assert [item["file_removed"] for item in body["items"]] == [True, False, False]


def test_an_ai_item_with_no_valid_citation_falls_back_to_the_original(client, db, student, project, monkeypatch):
    make_mistakes(client, db, student, project, 2)

    async def uncited(gateway, targets):
        return PracticeDraft.model_validate({"items": [
            {"mistake_id": str(targets[0].mistake_id), "question": "Q?", "options": ["w", "x", "y", "z"],
             "correct_index": 0, "explanation": "E.", "sections": []},
            # Cites a number outside its own Sections (the other target's).
            {"mistake_id": str(targets[1].mistake_id), "question": "Q?", "options": ["w", "x", "y", "z"],
             "correct_index": 0, "explanation": "E.", "sections": [1]},
        ]})

    CountingPractice(monkeypatch, replace=uncited)

    round_id, body = full_round(client, db, student, project)

    flags = db.execute(
        """
        SELECT pq.from_original FROM round_items ri JOIN practice_questions pq ON pq.id = ri.practice_question_id
        WHERE ri.round_id = %s ORDER BY ri.position
        """,
        (round_id,),
    ).fetchall()
    assert flags == [(True,), (True,)]
    assert [item["question"] for item in body["items"]] == ["Question 1?", "Question 2?"]
    assert [item["file_removed"] for item in body["items"]] == [False, False]


def test_a_mistake_withdrawn_during_generation_is_skipped(client, db, student, project, monkeypatch):
    mistake_ids, _ = make_mistakes(client, db, student, project, 3)
    real = Gateway.generate_practice

    async def withdraw_meanwhile(gateway, targets):
        db.execute("UPDATE mistakes SET withdrawn_at = now() WHERE id = %s", (mistake_ids[1],))
        return await real(gateway, targets)

    CountingPractice(monkeypatch, replace=withdraw_meanwhile)

    _, body = full_round(client, db, student, project)

    assert item_mistakes(db, [item["id"] for item in body["items"]]) == [mistake_ids[0], mistake_ids[2]]


def test_progress_moves_reading_then_writing_then_completes(slow, db, student):
    project = create_project(slow, student["token"])
    make_mistakes(slow, db, student, project, 2)
    job_id, _ = started(start(slow, student["token"], project))

    seen: list[str] = []
    deadline = time.monotonic() + 15
    while (row := job_row(db, job_id))[0] in ("queued", "running"):
        assert time.monotonic() < deadline
        if row[1] and (not seen or seen[-1] != row[1]):
            seen.append(row[1])
        time.sleep(0.05)

    assert seen == ["reading", "writing"]
    assert job_row(db, job_id)[0] == "completed"


def test_a_cancel_saves_nothing_and_leaves_the_count(slow, db, student):
    project = create_project(slow, student["token"])
    make_mistakes(slow, db, student, project, 2)
    job_id, round_id = started(start(slow, student["token"], project))
    wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=10)

    assert slow.post(f"/api/jobs/{job_id}/cancel", headers=bearer(student["token"])).status_code == 204

    assert wait_for_job(db, job_id) == "cancelled"
    assert items_in(db, round_id) == 0
    assert outstanding(slow, student["token"], project) == 2
    # The cancelled job no longer blocks a new round.
    second, _ = started(start(slow, student["token"], project))
    assert wait_for_job(db, second) == "completed"


def test_a_provider_failure_fails_the_job_and_leaves_the_count(client, db, student, project, monkeypatch):
    make_mistakes(client, db, student, project, 2)

    async def down(gateway, targets):
        raise ProviderUnavailable("down")

    CountingPractice(monkeypatch, replace=down)

    job_id, round_id = started(start(client, student["token"], project))

    assert wait_for_job(db, job_id) == "failed"
    assert job_row(db, job_id)[2] == "llm_unavailable"
    assert items_in(db, round_id) == 0
    assert outstanding(client, student["token"], project) == 2


def test_a_project_deleted_during_generation_saves_nothing(slow, db, student):
    project = create_project(slow, student["token"])
    make_mistakes(slow, db, student, project, 2)
    job_id, round_id = started(start(slow, student["token"], project))
    wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=10)

    db.execute("UPDATE projects SET deleted_at = now() WHERE id = %s", (project,))

    assert wait_for_job(db, job_id) == "cancelled"
    assert items_in(db, round_id) == 0


# --- Session (3.5) ---


def test_a_correct_answer_clears_the_mistake_and_links_the_answer(client, db, student, project):
    mistake_ids, _ = make_mistakes(client, db, student, project, 3)
    round_id, body = full_round(client, db, student, project)
    item = body["items"][0]

    response = answer_item(client, student["token"], project, round_id, item["id"], key_of(db, item["id"]))

    assert response.status_code == 200, response.text
    answered = response.json()
    assert (answered["cleared"], answered["cleared_count"], answered["remaining_outstanding"]) == (True, 1, 2)
    assert answered["answer"]["is_correct"] is True
    assert answered["answer"]["correct_option_id"] == key_of(db, item["id"])
    assert answered["answer"]["explanation"]
    assert answered["answer"]["sources"] == [{"label": "lecture.pdf · Page 1"}]
    assert answered["context"] == {"question": "Question 1?", "earlier_answer_text": "Alpha", "correct_text": "Beta"}
    cleared_at, cleared_by = db.execute(
        "SELECT cleared_at, cleared_by_answer_id FROM mistakes WHERE id = %s", (mistake_ids[0],)
    ).fetchone()
    answer_id = db.execute("SELECT id FROM practice_answers WHERE practice_question_id = %s", (item["id"],)).fetchone()[0]
    assert cleared_at is not None and cleared_by == answer_id
    assert outstanding(client, student["token"], project) == 2


def test_a_wrong_answer_keeps_the_mistake_and_makes_no_new_one(client, db, student, project):
    mistake_ids, _ = make_mistakes(client, db, student, project, 2)
    round_id, body = full_round(client, db, student, project)
    item = body["items"][0]
    before = mistakes_in(db, project)

    answered = answer_item(client, student["token"], project, round_id, item["id"], wrong_of(db, item["id"])).json()

    assert (answered["cleared"], answered["cleared_count"], answered["remaining_outstanding"]) == (False, 0, 2)
    assert answered["answer"]["is_correct"] is False
    assert mistakes_in(db, project) == before
    assert db.execute("SELECT cleared_at FROM mistakes WHERE id = %s", (mistake_ids[0],)).fetchone()[0] is None


def test_a_resubmit_returns_the_stored_result_and_clears_once(client, db, student, project):
    mistake_ids, _ = make_mistakes(client, db, student, project, 2)
    round_id, body = full_round(client, db, student, project)
    item = body["items"][0]
    key = key_of(db, item["id"])

    first = answer_item(client, student["token"], project, round_id, item["id"], key).json()
    cleared_at = db.execute("SELECT cleared_at FROM mistakes WHERE id = %s", (mistake_ids[0],)).fetchone()[0]
    again = answer_item(client, student["token"], project, round_id, item["id"], wrong_of(db, item["id"])).json()

    assert again == first
    assert db.execute("SELECT count(*) FROM practice_answers WHERE practice_question_id = %s",
                      (item["id"],)).fetchone()[0] == 1
    assert db.execute("SELECT cleared_at FROM mistakes WHERE id = %s", (mistake_ids[0],)).fetchone()[0] == cleared_at
    assert outstanding(client, student["token"], project) == 1


def test_round_done_with_mistakes_left(client, db, student, project):
    make_mistakes(client, db, student, project, 3)
    round_id, body = full_round(client, db, student, project)
    first, second, third = body["items"]

    answer_item(client, student["token"], project, round_id, first["id"], key_of(db, first["id"]))
    answer_item(client, student["token"], project, round_id, second["id"], wrong_of(db, second["id"]))
    answer_item(client, student["token"], project, round_id, third["id"], wrong_of(db, third["id"]))

    after = round_body(client, student["token"], project, round_id)
    assert all(item["answer"] is not None for item in after["items"])
    assert (after["cleared_count"], after["total"], after["remaining_outstanding"]) == (1, 3, 2)


def test_all_cleared_when_the_last_outstanding_mistake_clears(client, db, student, project):
    make_mistakes(client, db, student, project, 2)
    round_id, body = full_round(client, db, student, project)

    for item in body["items"]:
        last = answer_item(client, student["token"], project, round_id, item["id"], key_of(db, item["id"])).json()

    assert (last["cleared_count"], last["remaining_outstanding"]) == (2, 0)
    assert outstanding(client, student["token"], project) == 0
    # Cleared Mistakes and every attempt are kept.
    assert db.execute("SELECT count(*) FROM mistakes WHERE project_id = %s AND cleared_at IS NOT NULL",
                      (project,)).fetchone()[0] == 2


def test_a_new_round_after_one_right_and_one_wrong_generates_a_new_question(client, db, student, project,
                                                                            monkeypatch):
    # Acceptance: the answered item is not reused; the remaining Mistake gets a new Practice Question.
    mistake_ids, _ = make_mistakes(client, db, student, project, 2)
    round_id, body = full_round(client, db, student, project)
    first, second = body["items"]
    answer_item(client, student["token"], project, round_id, first["id"], key_of(db, first["id"]))
    answer_item(client, student["token"], project, round_id, second["id"], wrong_of(db, second["id"]))
    counting = CountingPractice(monkeypatch)

    _, next_round = full_round(client, db, student, project)

    assert next_round["total"] == 1
    assert next_round["items"][0]["id"] != second["id"]
    assert item_mistakes(db, [next_round["items"][0]["id"]]) == [mistake_ids[1]]
    assert len(counting.calls) == 1


def test_an_archived_project_refuses_start_and_answers_but_opens_the_round(client, db, student, project):
    make_mistakes(client, db, student, project, 2)
    round_id, body = full_round(client, db, student, project)
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project,))
    item = body["items"][0]

    assert_error(start(client, student["token"], project), 409, "project_read_only")
    assert_error(answer_item(client, student["token"], project, round_id, item["id"], "a"), 409, "project_read_only")
    assert get_round(client, student["token"], project, round_id).status_code == 200


def test_a_foreign_or_mismatched_round_or_item_is_not_found(client, gotrue, created, db, student, project):
    make_mistakes(client, db, student, project, 2)
    round_id, body = full_round(client, db, student, project)
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])

    assert_error(get_round(client, other["access_token"], other_project, round_id), 404, "not_found")
    assert_error(get_round(client, student["token"], project, str(uuid.uuid4())), 404, "not_found")
    assert_error(answer_item(client, other["access_token"], other_project, round_id, body["items"][0]["id"], "a"),
                 404, "not_found")
    assert_error(answer_item(client, student["token"], project, round_id, str(uuid.uuid4()), "a"), 404, "not_found")


def test_an_invalid_option_is_refused(client, db, student, project):
    make_mistakes(client, db, student, project, 1)
    round_id, body = full_round(client, db, student, project)

    response = answer_item(client, student["token"], project, round_id, body["items"][0]["id"], "e")

    assert response.status_code == 422


# --- Checking (pure) ---


class _S:
    def __init__(self, label: str, material_id=None) -> None:
        self.id = uuid.uuid4()
        self.material_id = material_id or uuid.uuid4()
        self.label = label
        self.text = f"{label} text"


def _target(sections) -> PracticeTarget:
    return PracticeTarget(uuid.uuid4(), "Q?", "A", sections)


def _draft(*items) -> PracticeDraft:
    return PracticeDraft.model_validate({"items": list(items)})


def _item(target, sections=(1,), options=("right", "w1", "w2", "w3"), correct_index=0, mistake_id=None) -> dict:
    return {"mistake_id": mistake_id or str(target.mistake_id), "question": "P?", "options": list(options),
            "correct_index": correct_index, "explanation": "E.", "sections": list(sections)}


def test_check_keeps_the_first_usable_item_per_target_and_shuffles_it():
    s1, s2 = _S("Page 1"), _S("Page 2")
    t1, t2 = _target([s1]), _target([s2])
    kept = review.check(
        _draft(_item(t1), _item(t1, options=("other", "x", "y", "z")), _item(t2, sections=(2,), correct_index=3)),
        [t1, t2], [s1, s2], random.Random(4),
    )

    assert set(kept) == {t1.mistake_id, t2.mistake_id}
    first = kept[t1.mistake_id]
    assert {o["id"]: o["text"] for o in first["options"]}[first["correct_option_id"]] == "right"
    assert (first["source_section_ids"], first["material_ids"], first["from_original"]) == ([s1.id], [s1.material_id], False)
    second = kept[t2.mistake_id]
    assert {o["id"]: o["text"] for o in second["options"]}[second["correct_option_id"]] == "w3"


@pytest.mark.parametrize(
    "item_options",
    [
        {"sections": ()},
        {"sections": (9,)},
        {"sections": (2,)},  # another target's Section
        {"options": ("same", "Same ", "x", "y")},
        {"options": ("a", " ", "x", "y")},
        {"mistake_id": "not-a-target"},
    ],
)
def test_check_drops_an_unusable_item(item_options):
    s1, s2 = _S("Page 1"), _S("Page 2")
    t1, t2 = _target([s1]), _target([s2])

    kept = review.check(_draft(_item(t1, **item_options)), [t1, t2], [s1, s2], random.Random(1))

    assert t1.mistake_id not in kept


def test_the_original_is_reshuffled_with_its_answer_kept():
    section_id = uuid.uuid4()
    mistake = {
        "id": uuid.uuid4(),
        "material_ids": [uuid.uuid4()],
        "question_snapshot": {"question": "Q?", "options": OPTIONS, "correct_option_id": "b", "explanation": "E.",
                              "source_section_ids": [str(section_id)]},
    }

    orders = set()
    for seed_value in range(20):
        made = review.original(mistake, random.Random(seed_value))
        assert {o["id"]: o["text"] for o in made["options"]}[made["correct_option_id"]] == "Beta"
        assert (made["from_original"], made["source_section_ids"]) == (True, [section_id])
        orders.add(made["correct_option_id"])
    assert len(orders) > 1


def test_the_mock_writes_one_item_per_target_deterministically(settings):
    gateway = Gateway(settings, "mock")
    s1, s2 = _S("Page 1"), _S("Page 2")
    targets = [PracticeTarget(uuid.uuid4(), "Q1?", "Beta", [s1]), PracticeTarget(uuid.uuid4(), "Q2?", "Gamma", [s2, s1])]

    first = run(gateway.generate_practice(targets))
    again = run(gateway.generate_practice(targets))

    assert first == again
    assert [item.mistake_id for item in first.items] == [str(t.mistake_id) for t in targets]
    assert [item.sections for item in first.items] == [[1], [2, 1]]
    assert first.items[0].options[first.items[0].correct_index] == "Beta"
    assert first.items[1].options[first.items[1].correct_index] == "Gamma"


# --- Review fixes: removal, reuse, model output, prompt size, status ---


def flags(db, round_id: str) -> list[tuple[str, str, bool]]:
    """(practice_question_id, mistake_id, from_original) per item, in order."""
    return [
        (str(a), str(b), c)
        for a, b, c in db.execute(
            """
            SELECT pq.id, pq.mistake_id, pq.from_original
            FROM round_items ri JOIN practice_questions pq ON pq.id = ri.practice_question_id
            WHERE ri.round_id = %s ORDER BY ri.position
            """,
            (round_id,),
        ).fetchall()
    ]


def test_a_removed_file_wins_over_reusing_an_earlier_practice_question(client, db, student, project, monkeypatch):
    _, material_id = make_mistakes(client, db, student, project, 2)
    first_id, _ = full_round(client, db, student, project)
    earlier = [row[0] for row in flags(db, first_id)]
    assert remove(client, student["token"], project, material_id, withdraw=False).status_code == 204
    counting = CountingPractice(monkeypatch)

    second_id, body = full_round(client, db, student, project)

    assert counting.calls == []
    rows = flags(db, second_id)
    assert [row[2] for row in rows] == [True, True]
    assert not {row[0] for row in rows} & set(earlier)
    assert [item["from_original"] for item in body["items"]] == [True, True]


def test_a_practice_question_answered_during_generation_is_not_reused(client, db, student, project, monkeypatch):
    old_ids, _ = make_mistakes(client, db, student, project, 2)
    first_id, _ = full_round(client, db, student, project)
    earlier = flags(db, first_id)
    new_ids, _ = make_mistakes(client, db, student, project, 1)
    real = Gateway.generate_practice

    async def answer_meanwhile(gateway, targets):
        db.execute(
            """
            INSERT INTO practice_answers (practice_question_id, account_id, submitted_option_id, is_correct)
            VALUES (%s, %s, 'a', false)
            """,
            (earlier[0][0], student["id"]),
        )
        return await real(gateway, targets)

    counting = CountingPractice(monkeypatch, replace=answer_meanwhile)

    second_id, _ = full_round(client, db, student, project)

    assert [str(t.mistake_id) for t in counting.calls[0]] == new_ids
    rows = flags(db, second_id)
    assert [row[1] for row in rows] == old_ids + new_ids
    assert rows[0][0] != earlier[0][0] and rows[0][2] is True  # answered meanwhile: the original instead
    assert rows[1][0] == earlier[1][0]  # still unanswered: reused
    assert rows[2][2] is False


def test_a_file_removed_during_generation_makes_that_item_the_original(client, db, student, project, monkeypatch):
    removed_ids, removed_material = make_mistakes(client, db, student, project, 1, file_name="old.pdf")
    live_ids, _ = make_mistakes(client, db, student, project, 1, file_name="new.pdf")
    real = Gateway.generate_practice

    async def remove_meanwhile(gateway, targets):
        db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (removed_material,))
        return await real(gateway, targets)

    CountingPractice(monkeypatch, replace=remove_meanwhile)

    round_id, body = full_round(client, db, student, project)

    assert [(row[1], row[2]) for row in flags(db, round_id)] == [(removed_ids[0], True), (live_ids[0], False)]
    assert [item["file_removed"] for item in body["items"]] == [True, False]


def test_every_mistake_withdrawn_during_generation_fails_the_job(client, db, student, project, monkeypatch):
    make_mistakes(client, db, student, project, 2)
    real = Gateway.generate_practice

    async def withdraw_all(gateway, targets):
        db.execute("UPDATE mistakes SET withdrawn_at = now() WHERE project_id = %s", (project,))
        return await real(gateway, targets)

    CountingPractice(monkeypatch, replace=withdraw_all)

    job_id, round_id = started(start(client, student["token"], project))

    assert wait_for_job(db, job_id) == "failed"
    assert job_row(db, job_id)[2] == "insufficient_material"
    assert items_in(db, round_id) == 0


def test_invalid_model_output_fails_the_job(client, db, student, project, monkeypatch):
    make_mistakes(client, db, student, project, 1)

    async def garbled(gateway, targets):
        raise LLMOutputError("bad")

    CountingPractice(monkeypatch, replace=garbled)

    job_id, round_id = started(start(client, student["token"], project))

    assert wait_for_job(db, job_id) == "failed"
    assert job_row(db, job_id)[2] == "llm_output_invalid"
    body = round_body(client, student["token"], project, round_id)
    assert (body["status"], body["error_code"], body["items"]) == ("failed", "llm_output_invalid", [])


def test_the_round_carries_its_jobs_status_while_being_made(slow, db, student):
    project = create_project(slow, student["token"])
    make_mistakes(slow, db, student, project, 1)
    job_id, round_id = started(start(slow, student["token"], project))

    body = round_body(slow, student["token"], project, round_id)
    assert body["status"] in ("queued", "running") and body["items"] == []

    assert wait_for_job(db, job_id) == "completed"
    done = round_body(slow, student["token"], project, round_id)
    assert (done["status"], done["error_code"], done["total"]) == ("completed", None, 1)


def test_answering_an_item_whose_mistake_was_withdrawn_saves_but_clears_nothing(client, db, student, project):
    mistake_ids, _ = make_mistakes(client, db, student, project, 1)
    round_id, body = full_round(client, db, student, project)
    item = body["items"][0]
    db.execute("UPDATE mistakes SET withdrawn_at = now() WHERE id = %s", (mistake_ids[0],))

    answered = answer_item(client, student["token"], project, round_id, item["id"], key_of(db, item["id"])).json()

    assert answered["answer"]["is_correct"] is True
    assert (answered["cleared"], answered["cleared_count"], answered["remaining_outstanding"]) == (False, 0, 0)
    assert db.execute("SELECT cleared_at, cleared_by_answer_id FROM mistakes WHERE id = %s",
                      (mistake_ids[0],)).fetchone() == (None, None)


async def _clear(settings, mistake_id, answer_id) -> bool:
    async with await psycopg.AsyncConnection.connect(settings.database_url.get_secret_value()) as conn:
        cleared = await mistakes.clear(conn, uuid.UUID(str(mistake_id)), uuid.UUID(str(answer_id)))
        await conn.commit()
        return cleared


def test_clear_with_a_foreign_wrong_or_mismatched_answer_clears_nothing(client, settings, db, student, project):
    mistake_ids, _ = make_mistakes(client, db, student, project, 2)
    round_id, body = full_round(client, db, student, project)
    first, second = body["items"]
    answer_item(client, student["token"], project, round_id, first["id"], key_of(db, first["id"]))
    answer_item(client, student["token"], project, round_id, second["id"], wrong_of(db, second["id"]))
    answer_ids = dict(db.execute(
        "SELECT practice_question_id::text, id FROM practice_answers WHERE practice_question_id = ANY(%s::uuid[])",
        ([first["id"], second["id"]],),
    ).fetchall())

    # Another Mistake's correct answer, its own wrong answer, and a made-up id.
    assert run(_clear(settings, mistake_ids[1], answer_ids[first["id"]])) is False
    assert run(_clear(settings, mistake_ids[1], answer_ids[second["id"]])) is False
    assert run(_clear(settings, mistake_ids[1], uuid.uuid4())) is False
    assert db.execute("SELECT cleared_at FROM mistakes WHERE id = %s", (mistake_ids[1],)).fetchone()[0] is None
    # Idempotent for the right pair.
    assert run(_clear(settings, mistake_ids[0], answer_ids[first["id"]])) is True


def test_targets_beyond_the_context_budget_use_their_originals(settings, db, student, monkeypatch):
    budget = settings.model_copy(update={"llm_context_budget_tokens": 1_000})
    with TestClient(create_app(budget), backend_options=LOOP) as small:
        project = create_project(small, student["token"])
        mistake_ids, material_id = make_mistakes(small, db, student, project, 3)
        db.execute("UPDATE sections SET text = repeat('word ', 600) WHERE material_id = %s", (material_id,))
        counting = CountingPractice(monkeypatch)

        round_id, _ = full_round(small, db, student, project)

    assert [str(t.mistake_id) for t in counting.calls[0]] == mistake_ids[:1]
    assert [row[2] for row in flags(db, round_id)] == [False, True, True]


def test_a_long_section_is_cut_in_the_prompt(client, db, student, project, monkeypatch):
    _, material_id = make_mistakes(client, db, student, project, 1)
    db.execute("UPDATE sections SET text = repeat('x', 10000) WHERE material_id = %s", (material_id,))
    counting = CountingPractice(monkeypatch)

    full_round(client, db, student, project)

    assert [len(s.text) for s in counting.calls[0][0].sections] == [review.TARGET_TEXT_CHARS]


def test_plan_targets_keeps_a_targets_sections_within_the_cap():
    s1, s2 = _S("Page 1"), _S("Page 2")
    s1.text, s2.text = "a" * 3000, "b" * 3000
    m = {"id": uuid.uuid4(), "question_snapshot": {
        "question": "Q?", "options": OPTIONS, "correct_option_id": "b",
        "source_section_ids": [str(s1.id), "not-an-id", str(s2.id)]}}

    (target,) = review.plan_targets([m], {s1.id: s1, s2.id: s2}, 100_000)

    assert list(target.sections) == [s1]
    assert (target.question_text, target.correct_text) == ("Q?", "Beta")


def test_a_bad_snapshot_section_id_is_skipped_not_fatal():
    good = uuid.uuid4()
    mistake = {"id": uuid.uuid4(), "material_ids": [uuid.uuid4()], "question_snapshot": {
        "question": "Q?", "options": OPTIONS, "correct_option_id": "b", "explanation": "E.",
        "source_section_ids": ["nope", str(good)]}}

    assert review.snapshot_sections(mistake["question_snapshot"]) == [good]
    assert review.original(mistake, random.Random(1))["source_section_ids"] == [good]


def test_check_matches_an_upper_case_mistake_id():
    s1 = _S("Page 1")
    t1 = _target([s1])

    kept = review.check(_draft(_item(t1, mistake_id=str(t1.mistake_id).upper())), [t1], [s1], random.Random(1))

    assert set(kept) == {t1.mistake_id}


def test_check_drops_an_item_that_echoes_the_original_question():
    s1 = _S("Page 1")
    t1 = PracticeTarget(uuid.uuid4(), "What is  the Calvin cycle?", "A", [s1])
    echo = _item(t1)
    echo["question"] = " what is the calvin   CYCLE? "

    assert review.check(_draft(echo), [t1], [s1], random.Random(1)) == {}
