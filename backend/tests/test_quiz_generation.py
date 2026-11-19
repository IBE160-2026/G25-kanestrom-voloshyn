"""Quiz generation: the request, the `quiz` job, the save, cancel, and progress (Story 3.1a, FR-10,
FR-26, AD-7, AD-9, AD-20). Runs in mock mode; `LLM_MOCK_DELAY_MS` holds each step so progress and
cancel can be observed. Needs local Supabase, like test_materials.py.
"""

import random
import time
import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb

from app.llm import Gateway, LLMOutputError, ProviderUnavailable, QuizDraft
from app.main import create_app
from app.services import quiz
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
    insert_material,
    student,
    upload_and_wait,
    wait_for,
    wait_for_job,
)
from tests.test_scope import ALL, make_quiz, seed, words

DELAY_MS = 600


def job_row(db, job_id: str) -> tuple:
    return db.execute(
        "SELECT status, progress_step, error_code, result_ref, cancel_requested FROM generation_jobs WHERE id = %s",
        (job_id,),
    ).fetchone()


def quizzes_in(db, project_id: str) -> int:
    return db.execute("SELECT count(*) FROM quizzes WHERE project_id = %s", (project_id,)).fetchone()[0]


def questions_of(db, quiz_id) -> list[tuple]:
    return db.execute(
        """
        SELECT position, question, options, correct_option_id, explanation, source_section_ids, material_ids
        FROM quiz_questions WHERE quiz_id = %s ORDER BY position
        """,
        (quiz_id,),
    ).fetchall()


def cancel(client, token: str, job_id: str):
    return client.post(f"/api/jobs/{job_id}/cancel", headers=bearer(token))


def started(response) -> str:
    assert response.status_code == 202, response.text
    return response.json()["job_id"]


def wait_for_step(db, job_id: str, step: str) -> None:
    wait_for(lambda: job_row(db, job_id)[1] == step, timeout=10)


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


@pytest.fixture
def slow(settings):
    """A client whose mock tasks and steps each take `DELAY_MS`."""
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": DELAY_MS})), backend_options=LOOP) as c:
        yield c


# --- Generate (matrix: Generate, mock) ---


def test_a_mock_quiz_of_10_from_all_topics_saves_10_cited_questions(client, student, db, project):
    material = upload_and_wait(client, student["token"], project, "photosynthesis-notes.md")
    scope_sections = {
        row[0] for row in db.execute("SELECT id FROM sections WHERE material_id = %s", (material["id"],))
    }

    job_id = started(make_quiz(client, student["token"], project, ALL, count=10))

    assert wait_for_job(db, job_id) == "completed"
    status, step, error, quiz_id, _ = job_row(db, job_id)
    assert (step, error) == (None, None)
    response = client.get(f"/api/projects/{project}/quizzes/{quiz_id}", headers=bearer(student["token"]))
    assert response.status_code == 200, response.text
    body = response.json()
    assert {k: body[k] for k in ("id", "requested_count", "question_count")} == {
        "id": str(quiz_id), "requested_count": 10, "question_count": 10,
    }
    assert [q["position"] for q in body["questions"]] == list(range(10))

    questions = questions_of(db, quiz_id)
    assert [q[0] for q in questions] == list(range(10))
    for _, question, options, correct, explanation, sources, material_ids in questions:
        assert question and explanation
        assert [o["id"] for o in options] == ["a", "b", "c", "d"]
        assert correct in {"a", "b", "c", "d"}
        assert len({o["text"] for o in options}) == 4
        assert sources and set(sources) <= scope_sections
        assert [str(m) for m in material_ids] == [material["id"]]

    saved = db.execute("SELECT generation_params, job_id FROM quizzes WHERE id = %s", (quiz_id,)).fetchone()
    params = db.execute("SELECT params FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0]
    assert saved == (params, uuid.UUID(job_id))


def test_progress_moves_reading_writing_checking_then_completes(slow, student, db):
    project = create_project(slow, student["token"])
    seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project, ALL, count=5))

    seen: list[str] = []
    deadline = time.monotonic() + 15
    while (row := job_row(db, job_id))[0] in ("queued", "running"):
        assert time.monotonic() < deadline
        if row[1] and (not seen or seen[-1] != row[1]):
            seen.append(row[1])
        time.sleep(0.05)

    assert seen == ["reading", "writing", "checking"]
    assert job_row(db, job_id)[0] == "completed"


def test_the_jobs_list_shows_the_running_quiz_and_its_step(slow, student, db):
    project = create_project(slow, student["token"])
    seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project, ALL, count=5))
    wait_for_step(db, job_id, "writing")

    listed = slow.get(f"/api/projects/{project}/jobs", headers=bearer(student["token"])).json()

    assert [(j["id"], j["kind"], j["status"], j["progress_step"]) for j in listed] == [
        (job_id, "quiz", "running", "writing")
    ]
    assert wait_for_job(db, job_id) == "completed"


def test_the_jobs_list_carries_a_quiz_jobs_frozen_topic_labels(client, student, db, project):
    # Story 3.1b: the "is ready" notice names the Topics; "All topics" is an empty list.
    _, _, topic_ids = seed(db, student["id"], project, ["a", "b", "c"])
    all_job = started(make_quiz(client, student["token"], project, ALL, count=5))
    assert wait_for_job(db, all_job) == "completed"
    some_job = started(make_quiz(client, student["token"], project, {"topic_ids": [topic_ids[2], topic_ids[0]]}, count=5))
    assert wait_for_job(db, some_job) == "completed"

    listed = client.get(f"/api/projects/{project}/jobs", headers=bearer(student["token"])).json()

    labels = {j["id"]: j["topic_labels"] for j in listed if j["kind"] == "quiz"}
    assert labels == {all_job: [], some_job: ["Topic 3", "Topic 1"]}
    assert all("params" not in j for j in listed)


@pytest.mark.parametrize(
    "params",
    [
        {"count": 5},
        {"count": 5, "topic_labels": None},
        {"count": 5, "topic_labels": "Cells"},
        {"count": 5, "topic_labels": ["Cells", 3, None, {"x": 1}]},
    ],
)
def test_odd_stored_topic_labels_never_break_the_jobs_list(client, student, db, project, params):
    db.execute(
        """
        INSERT INTO generation_jobs (account_id, project_id, kind, params, status, result_ref, finished_at)
        VALUES (%s, %s, 'quiz', %s, 'failed', NULL, now())
        """,
        (student["id"], project, Jsonb(params)),
    )

    response = client.get(f"/api/projects/{project}/jobs", headers=bearer(student["token"]))

    assert response.status_code == 200, response.text
    expected = ["Cells"] if isinstance(params.get("topic_labels"), list) else []
    assert [j["topic_labels"] for j in response.json()] == [expected]


def test_other_job_kinds_list_no_topic_labels(client, student, project):
    upload_and_wait(client, student["token"], project, "photosynthesis-notes.md")

    listed = client.get(f"/api/projects/{project}/jobs", headers=bearer(student["token"])).json()

    assert [(j["kind"], j["topic_labels"]) for j in listed] == [("material_processing", [])]


def test_fewer_possible_saves_only_what_the_material_supports(client, student, db, project):
    # Six one-word Sections: capacity 6.
    seed(db, student["id"], project, ["text"] * 6)

    job_id = started(make_quiz(client, student["token"], project, ALL, count=10))

    assert wait_for_job(db, job_id) == "completed"
    quiz_id = job_row(db, job_id)[3]
    body = client.get(f"/api/projects/{project}/quizzes/{quiz_id}", headers=bearer(student["token"])).json()
    # The frozen count is 10 cut to the capacity: 6.
    assert (body["requested_count"], body["question_count"]) == (6, 6)


def test_a_model_returning_more_than_the_frozen_count_is_cut_to_it(client, student, db, project, monkeypatch):
    async def generous(self, sections, count, topic_labels=()):
        assert count == 6
        return QuizDraft.model_validate({"questions": [q(cited=(1,)) for _ in range(10)]})

    monkeypatch.setattr(Gateway, "generate_quiz", generous)
    seed(db, student["id"], project, ["text"] * 6)

    job_id = started(make_quiz(client, student["token"], project, ALL, count=10))

    assert wait_for_job(db, job_id) == "completed"
    quiz_id = job_row(db, job_id)[3]
    assert len(questions_of(db, quiz_id)) == 6
    assert db.execute("SELECT requested_count FROM quizzes WHERE id = %s", (quiz_id,)).fetchone()[0] == 6


def test_never_more_than_20_questions(client, student, db, project):
    seed(db, student["id"], project, [words(200)] * 25)

    job_id = started(make_quiz(client, student["token"], project, ALL, count=20))

    assert wait_for_job(db, job_id) == "completed"
    assert len(questions_of(db, job_row(db, job_id)[3])) == 20


def test_a_topic_scope_cites_only_its_sections(client, student, db, project):
    _, sections, topic_ids = seed(db, student["id"], project, ["a", "b", "c", "d"], topics=[[0, 1], [2, 3]])

    job_id = started(make_quiz(client, student["token"], project, {"topic_ids": [topic_ids[1]]}, count=5))

    assert wait_for_job(db, job_id) == "completed"
    cited = {str(s) for q in questions_of(db, job_row(db, job_id)[3]) for s in q[5]}
    assert cited <= set(sections[2:])


# --- Read-only (matrix: Read-only; AC: archived Project with a running job) ---


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_a_read_only_project_refuses_a_quiz(client, student, db, project, column):
    seed(db, student["id"], project, ["text"])
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project,))

    assert_error(make_quiz(client, student["token"], project, ALL), 409, "project_read_only")


def test_a_quiz_job_still_saves_after_its_project_is_archived(slow, student, db):
    project = create_project(slow, student["token"])
    seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project, ALL, count=5))
    wait_for_step(db, job_id, "writing")

    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project,))

    assert wait_for_job(db, job_id) == "completed"
    assert quizzes_in(db, project) == 1


def test_a_quiz_job_saves_nothing_when_its_project_is_deleted(slow, student, db):
    project = create_project(slow, student["token"])
    seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project, ALL, count=5))
    wait_for_step(db, job_id, "writing")

    db.execute("UPDATE projects SET deleted_at = now() WHERE id = %s", (project,))

    assert wait_for_job(db, job_id) == "cancelled"
    assert quizzes_in(db, project) == 0


# --- Removed meanwhile ---


def test_a_file_removed_before_the_save_cancels_the_job_and_saves_nothing(slow, student, db):
    project = create_project(slow, student["token"])
    material_id, _, _ = seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project, ALL, count=5))
    wait_for_step(db, job_id, "writing")

    removed = slow.delete(f"/api/projects/{project}/materials/{material_id}", headers=bearer(student["token"]))
    assert removed.status_code == 204, removed.text

    assert wait_for_job(db, job_id) == "cancelled"
    assert quizzes_in(db, project) == 0


class CountingQuiz:
    """Counts `generate_quiz` calls, delegating to the mock."""

    def __init__(self, monkeypatch) -> None:
        self.calls = 0
        real = Gateway.generate_quiz

        async def counted(gateway, sections, count, topic_labels=()):
            self.calls += 1
            return await real(gateway, sections, count, topic_labels)

        monkeypatch.setattr(Gateway, "generate_quiz", counted)


def test_a_file_removed_while_reading_stops_the_job_before_the_model_call(slow, student, db, monkeypatch):
    counting = CountingQuiz(monkeypatch)
    project = create_project(slow, student["token"])
    material_id, _, _ = seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project, ALL, count=5))
    wait_for_step(db, job_id, "reading")

    removed = slow.delete(f"/api/projects/{project}/materials/{material_id}", headers=bearer(student["token"]))
    assert removed.status_code == 204, removed.text

    assert wait_for_job(db, job_id) == "cancelled"
    assert counting.calls == 0
    assert quizzes_in(db, project) == 0


def test_a_cancel_while_reading_stops_the_job_before_the_model_call(slow, student, db, monkeypatch):
    counting = CountingQuiz(monkeypatch)
    project = create_project(slow, student["token"])
    seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(slow, student["token"], project, ALL, count=5))
    wait_for_step(db, job_id, "reading")
    # Flag the cancel without interrupting the task, as when the cancel lands on another process step.
    db.execute("UPDATE generation_jobs SET cancel_requested = true WHERE id = %s", (job_id,))

    assert wait_for_job(db, job_id) == "cancelled"
    assert counting.calls == 0


# --- Cancel ---


def test_cancel_while_writing_ends_the_job_cancelled_and_saves_nothing(settings, student, db):
    # A long model call: the cancel interrupts it instead of waiting for it.
    with TestClient(create_app(settings.model_copy(update={"llm_mock_delay_ms": 5000})), backend_options=LOOP) as c:
        project = create_project(c, student["token"])
        seed(db, student["id"], project, ["text"] * 5)
        job_id = started(make_quiz(c, student["token"], project, ALL, count=5))
        wait_for(lambda: job_row(db, job_id)[1] == "writing", timeout=15)

        began = time.monotonic()
        response = cancel(c, student["token"], job_id)
        assert response.status_code == 204, response.text
        assert wait_for_job(db, job_id) == "cancelled"
        assert time.monotonic() - began < 3

    status, step, error, result_ref, requested = job_row(db, job_id)
    assert (status, step, requested, result_ref) == ("cancelled", None, True, None)
    assert quizzes_in(db, project) == 0


def test_cancel_of_a_queued_job_ends_it_at_once(client, student, db, project):
    job_id = db.execute(
        "INSERT INTO generation_jobs (account_id, project_id, kind) VALUES (%s, %s, 'quiz') RETURNING id",
        (student["id"], project),
    ).fetchone()[0]

    assert cancel(client, student["token"], str(job_id)).status_code == 204

    status, step, _, _, _ = job_row(db, job_id)
    assert (status, step) == ("cancelled", None)


def test_cancel_of_a_finished_job_changes_nothing(client, student, db, project):
    seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(client, student["token"], project, ALL, count=5))
    assert wait_for_job(db, job_id) == "completed"

    assert cancel(client, student["token"], job_id).status_code == 204

    assert job_row(db, job_id)[0] == "completed"
    assert quizzes_in(db, project) == 1


def test_cancel_works_in_an_archived_project(client, student, db, project):
    job_id = db.execute(
        "INSERT INTO generation_jobs (account_id, project_id, kind) VALUES (%s, %s, 'quiz') RETURNING id",
        (student["id"], project),
    ).fetchone()[0]
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project,))

    assert cancel(client, student["token"], str(job_id)).status_code == 204
    assert job_row(db, job_id)[0] == "cancelled"


def test_cancel_of_another_accounts_job_or_a_file_job_is_not_found(client, gotrue, created, student, db, project):
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    foreign = db.execute(
        "INSERT INTO generation_jobs (account_id, project_id, kind) VALUES (%s, %s, 'quiz') RETURNING id",
        (other["user"]["id"], other_project),
    ).fetchone()[0]
    processing = db.execute(
        "INSERT INTO generation_jobs (account_id, project_id, kind) VALUES (%s, %s, 'material_processing') RETURNING id",
        (student["id"], project),
    ).fetchone()[0]

    assert_error(cancel(client, student["token"], str(foreign)), 404, "not_found")
    assert_error(cancel(client, student["token"], str(processing)), 404, "not_found")
    assert_error(cancel(client, student["token"], str(uuid.uuid4())), 404, "not_found")
    assert job_row(db, foreign)[0] == "queued"
    assert job_row(db, processing)[0] == "queued"


# --- Failure ---


@pytest.mark.parametrize(
    ("error", "code"),
    [(ProviderUnavailable("down"), "llm_unavailable"), (LLMOutputError("bad"), "llm_output_invalid")],
)
def test_a_gateway_error_fails_the_job_and_saves_nothing(client, student, db, project, monkeypatch, error, code):
    async def failing(self, sections, count, topic_labels=()):
        raise error

    monkeypatch.setattr(Gateway, "generate_quiz", failing)
    seed(db, student["id"], project, ["text"] * 5)

    job_id = started(make_quiz(client, student["token"], project, ALL, count=5))

    assert wait_for_job(db, job_id) == "failed"
    assert job_row(db, job_id)[2] == code
    assert quizzes_in(db, project) == 0
    # The setup is kept in the params, so Try again can start a new job from the same choices.
    assert db.execute("SELECT params->>'count' FROM generation_jobs WHERE id = %s", (job_id,)).fetchone()[0] == "5"
    again = started(make_quiz(client, student["token"], project, ALL, count=5))
    assert again != job_id


def test_zero_usable_questions_fails_with_insufficient_material(client, student, db, project, monkeypatch):
    async def uncited(self, sections, count, topic_labels=()):
        return QuizDraft.model_validate(
            {"questions": [{"question": "Q?", "options": ["a", "b", "c", "d"], "correct_index": 0,
                            "explanation": "E", "sections": [99]}]}
        )

    monkeypatch.setattr(Gateway, "generate_quiz", uncited)
    seed(db, student["id"], project, ["text"] * 5)

    job_id = started(make_quiz(client, student["token"], project, ALL, count=5))

    assert wait_for_job(db, job_id) == "failed"
    assert job_row(db, job_id)[2] == "insufficient_material"
    assert quizzes_in(db, project) == 0


def test_the_quiz_endpoint_is_not_found_for_another_project_or_account(client, gotrue, created, student, db, project):
    seed(db, student["id"], project, ["text"] * 5)
    job_id = started(make_quiz(client, student["token"], project, ALL, count=5))
    assert wait_for_job(db, job_id) == "completed"
    quiz_id = job_row(db, job_id)[3]
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    second = create_project(client, student["token"])

    assert_error(client.get(f"/api/projects/{second}/quizzes/{quiz_id}", headers=bearer(student["token"])), 404,
                 "not_found")
    assert_error(client.get(f"/api/projects/{other_project}/quizzes/{quiz_id}",
                            headers=bearer(other["access_token"])), 404, "not_found")


# --- Checking (pure) ---


def sections(n: int) -> list[SimpleNamespace]:
    material = uuid.uuid4()
    return [SimpleNamespace(id=uuid.uuid4(), material_id=material, label=f"Page {i}", text="t") for i in range(n)]


def draft(*questions) -> QuizDraft:
    return QuizDraft.model_validate({"questions": list(questions)})


def q(correct_index: int = 0, cited=(1,), options=("right", "w1", "w2", "w3")) -> dict:
    opts = list(options)
    opts[0], opts[correct_index] = opts[correct_index], opts[0]
    return {"question": "Q?", "options": opts, "correct_index": correct_index, "explanation": "E",
            "sections": list(cited)}


def test_check_shuffles_into_a_to_d_and_keeps_the_correct_answer():
    secs = sections(2)
    positions = set()
    for seed_value in range(40):
        (kept,) = quiz.check(draft(q(correct_index=2)), secs, 5, random.Random(seed_value))
        assert [o["id"] for o in kept["options"]] == ["a", "b", "c", "d"]
        correct = next(o for o in kept["options"] if o["id"] == kept["correct_option_id"])
        assert correct["text"] == "right"
        positions.add(kept["correct_option_id"])
    assert len(positions) > 1  # not always in the same place


def test_check_maps_numbers_to_section_ids_and_drops_uncited_or_unknown_ones():
    secs = sections(3)
    kept = quiz.check(draft(q(cited=(2, 3, 2)), q(cited=()), q(cited=(4, 0)), q(cited=(1, 9))), secs, 10,
                      random.Random(1))
    assert [k["source_section_ids"] for k in kept] == [[secs[1].id, secs[2].id], [secs[0].id]]
    assert kept[0]["material_ids"] == [secs[0].material_id]


@pytest.mark.parametrize(
    "options",
    [("right", "w1", "w1", "w3"), ("right", "W1 ", " w1", "w3"), ("right", "w1", "  ", "w3"), ("right", "", "w2", "w3")],
)
def test_check_drops_a_question_with_a_blank_or_repeated_option(options):
    kept = quiz.check(draft(q(options=options), q()), sections(1), 5, random.Random(1))
    assert len(kept) == 1
    assert sorted(o["text"] for o in kept[0]["options"]) == ["right", "w1", "w2", "w3"]


def test_check_keeps_at_most_count():
    kept = quiz.check(draft(*[q() for _ in range(8)]), sections(1), 5, random.Random(1))
    assert len(kept) == 5


def test_quiz_draft_cuts_more_than_20_questions():
    assert len(draft(*[q() for _ in range(25)]).questions) == 20


def test_the_mock_returns_min_of_count_and_capacity():
    import asyncio

    from app.config import Settings

    gateway = Gateway(Settings(_env_file=None, llm_mode="mock"), "mock")
    six = [SimpleNamespace(label=f"Page {i}", text="one") for i in range(6)]
    long = [SimpleNamespace(label="Page 1", text=words(800))]

    assert len(asyncio.run(gateway.generate_quiz(six, 10)).questions) == 6
    assert len(asyncio.run(gateway.generate_quiz(six, 5)).questions) == 5
    assert len(asyncio.run(gateway.generate_quiz(long, 20)).questions) == 10
    cited = [question.sections for question in asyncio.run(gateway.generate_quiz(six, 5)).questions]
    assert cited == [[1], [2], [3], [4], [5]]
