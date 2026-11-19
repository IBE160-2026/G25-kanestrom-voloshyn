"""Wrong answers become Mistakes, the summary counts them, and file removal can withdraw them (Story 3.3,
FR-9, FR-12, FR-20, AD-10, AD-23). Quizzes are inserted straight into the database, like
test_quiz_answers.py. Needs local Supabase.
"""

import asyncio
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

from app.errors import AppError
from app.services import materials, mistakes
from tests.test_auth import (  # noqa: F401 -- shared fixtures
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
)
from tests.test_quiz_answers import OPTIONS, answer, insert_quiz

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def summary(client, token: str, project_id: str):
    return client.get(f"/api/projects/{project_id}/mistakes/summary", headers=bearer(token))


def outstanding(client, token: str, project_id: str) -> int:
    response = summary(client, token, project_id)
    assert response.status_code == 200, response.text
    return response.json()["outstanding"]


def remove(client, token: str, project_id: str, material_id: str, withdraw: bool | None = None):
    query = "" if withdraw is None else f"?withdraw_mistakes={'true' if withdraw else 'false'}"
    return client.delete(f"/api/projects/{project_id}/materials/{material_id}{query}", headers=bearer(token))


def mistake_rows(db, question_ids: list[str]) -> list[tuple]:
    return db.execute(
        """
        SELECT quiz_question_id::text, failed_answer_id::text, material_ids::text[], question_snapshot,
               cleared_at, withdrawn_at
        FROM mistakes WHERE quiz_question_id = ANY(%s::uuid[]) ORDER BY created_at
        """,
        (question_ids,),
    ).fetchall()


def run(coro):
    if sys.platform == "win32":
        return asyncio.run(coro, loop_factory=asyncio.SelectorEventLoop)
    return asyncio.run(coro)


async def _record(settings, account_id, project_id, question_id, answer_id) -> bool:
    url = settings.database_url.get_secret_value()
    async with await psycopg.AsyncConnection.connect(url) as conn:
        inserted = await mistakes.record_failure(
            conn, uuid.UUID(account_id), uuid.UUID(project_id), uuid.UUID(question_id), uuid.UUID(answer_id)
        )
        await conn.commit()
        return inserted


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


# --- Wrong answer, right answer ---


def test_a_wrong_answer_becomes_one_mistake_with_its_snapshot(client, student, db, project):
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, correct="b")

    assert answer(client, student["token"], project, quiz_id, question_ids[0], "d").status_code == 200

    rows = mistake_rows(db, question_ids)
    assert len(rows) == 1
    question_id, failed_answer_id, material_ids, snapshot, cleared_at, withdrawn_at = rows[0]
    answer_id = db.execute("SELECT id::text FROM quiz_answers WHERE quiz_question_id = %s",
                           (question_ids[0],)).fetchone()[0]
    assert (question_id, failed_answer_id, material_ids) == (question_ids[0], answer_id, [material_id])
    section_id = db.execute("SELECT source_section_ids[1]::text FROM quiz_questions WHERE id = %s",
                            (question_ids[0],)).fetchone()[0]
    assert snapshot == {
        "question": "Question 1?",
        "options": OPTIONS,
        "correct_option_id": "b",
        "explanation": "Because 1.",
        "source_section_ids": [section_id],
    }
    assert cleared_at is None and withdrawn_at is None
    account, project_of = db.execute("SELECT account_id::text, project_id::text FROM mistakes WHERE quiz_question_id = %s",
                                     (question_ids[0],)).fetchone()
    assert (account, project_of) == (student["id"], project)
    assert outstanding(client, student["token"], project) == 1


def test_a_right_answer_makes_no_mistake(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")

    assert answer(client, student["token"], project, quiz_id, question_ids[0], "b").status_code == 200

    assert mistake_rows(db, question_ids) == []
    assert outstanding(client, student["token"], project) == 0


# --- Resubmit, same question again ---


def test_a_resubmit_keeps_one_mistake(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")

    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    # A resubmit with the right option still returns the stored wrong answer and records nothing more.
    answer(client, student["token"], project, quiz_id, question_ids[0], "b")

    assert len(mistake_rows(db, question_ids)) == 1
    assert outstanding(client, student["token"], project) == 1


def test_a_repeat_failure_while_outstanding_is_a_no_op_and_after_clearing_makes_a_new_row(
    client, settings, student, db, project
):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    answer_id = db.execute("SELECT id::text FROM quiz_answers WHERE quiz_question_id = %s",
                           (question_ids[0],)).fetchone()[0]

    assert run(_record(settings, student["id"], project, question_ids[0], answer_id)) is False
    assert len(mistake_rows(db, question_ids)) == 1

    # Cleared (Story 3.5 writes this through the service; set directly here) rows stay as history.
    db.execute("UPDATE mistakes SET cleared_at = now() WHERE quiz_question_id = %s", (question_ids[0],))
    assert outstanding(client, student["token"], project) == 0
    assert run(_record(settings, student["id"], project, question_ids[0], answer_id)) is True
    assert len(mistake_rows(db, question_ids)) == 2
    assert outstanding(client, student["token"], project) == 1


def test_the_index_refuses_a_second_outstanding_row(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")

    with pytest.raises(psycopg.errors.UniqueViolation):
        db.execute(
            """
            INSERT INTO mistakes (account_id, project_id, quiz_question_id, failed_answer_id, material_ids,
                                  question_snapshot)
            SELECT account_id, project_id, quiz_question_id, failed_answer_id, material_ids, question_snapshot
            FROM mistakes WHERE quiz_question_id = %s
            """,
            (question_ids[0],),
        )


def test_a_foreign_question_records_nothing(settings, client, gotrue, created, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    answer_id = db.execute("SELECT id::text FROM quiz_answers WHERE quiz_question_id = %s",
                           (question_ids[0],)).fetchone()[0]
    db.execute("UPDATE mistakes SET withdrawn_at = now() WHERE quiz_question_id = %s", (question_ids[0],))
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])

    assert run(_record(settings, other["user"]["id"], other_project, question_ids[0], answer_id)) is False
    assert len(mistake_rows(db, question_ids)) == 1


@pytest.mark.parametrize("leave", ["cleared_at", "withdrawn_at"])
def test_a_resubmit_after_the_mistake_left_review_records_nothing(client, student, db, project, leave):
    # The stored answer is not new, so no Mistake, even though the index would now allow one.
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    db.execute(f"UPDATE mistakes SET {leave} = now() WHERE quiz_question_id = %s", (question_ids[0],))

    assert answer(client, student["token"], project, quiz_id, question_ids[0], "a").status_code == 200

    assert outstanding(client, student["token"], project) == 0
    assert len(mistake_rows(db, question_ids)) == 1


def test_a_correct_or_mismatched_answer_id_records_nothing(client, settings, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, n=3, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "b")  # correct
    answer(client, student["token"], project, quiz_id, question_ids[1], "a")  # wrong
    answer_ids = dict(
        db.execute(
            "SELECT quiz_question_id::text, id::text FROM quiz_answers WHERE quiz_question_id = ANY(%s::uuid[])",
            (question_ids,),
        ).fetchall()
    )
    db.execute("UPDATE mistakes SET cleared_at = now() WHERE quiz_question_id = %s", (question_ids[1],))

    # A correct answer, another Question's wrong answer, and a made-up id.
    assert run(_record(settings, student["id"], project, question_ids[0], answer_ids[question_ids[0]])) is False
    assert run(_record(settings, student["id"], project, question_ids[2], answer_ids[question_ids[1]])) is False
    assert run(_record(settings, student["id"], project, question_ids[1], str(uuid.uuid4()))) is False
    assert outstanding(client, student["token"], project) == 0
    assert len(mistake_rows(db, question_ids)) == 1


def test_a_mistake_is_never_both_cleared_and_withdrawn(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")

    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("UPDATE mistakes SET cleared_at = now(), withdrawn_at = now() WHERE quiz_question_id = %s",
                   (question_ids[0],))


# --- Leave part-way ---


def test_leaving_part_way_keeps_the_answered_mistakes(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, n=10, correct="b")

    for question_id, option in zip(question_ids[:3], ["a", "b", "c"], strict=True):
        assert answer(client, student["token"], project, quiz_id, question_id, option).status_code == 200

    assert outstanding(client, student["token"], project) == 2


# --- Summary ---


def test_the_summary_counts_per_material(client, student, db, project):
    first_quiz, first_questions, first_material = insert_quiz(db, student["id"], project, n=3, correct="b")
    second_quiz, second_questions, second_material = insert_quiz(db, student["id"], project, n=2, correct="b")
    for question_id in first_questions:
        answer(client, student["token"], project, first_quiz, question_id, "a")
    answer(client, student["token"], project, second_quiz, second_questions[0], "c")

    body = summary(client, student["token"], project).json()

    assert body == {"outstanding": 4, "by_material": {first_material: 3, second_material: 1}}


def test_the_summary_of_a_project_without_mistakes_is_zero(client, student, project):
    assert summary(client, student["token"], project).json() == {"outstanding": 0, "by_material": {}}


def test_the_summary_counts_only_this_project(client, student, db, project):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    elsewhere = create_project(client, student["token"])

    assert outstanding(client, student["token"], elsewhere) == 0


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_a_read_only_projects_summary_is_still_readable(client, student, db, project, column):
    quiz_id, question_ids, _ = insert_quiz(db, student["id"], project, n=5, correct="b")
    for question_id in question_ids:
        answer(client, student["token"], project, quiz_id, question_id, "a")
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project,))

    assert outstanding(client, student["token"], project) == 5


def test_a_foreign_or_missing_project_summary_is_not_found(client, gotrue, created, student, project):
    other = sign_up(gotrue, created)

    assert_error(summary(client, other["access_token"], project), 404, "not_found")
    assert_error(summary(client, student["token"], str(uuid.uuid4())), 404, "not_found")
    assert_error(client.get(f"/api/projects/{project}/mistakes/summary"), 401, "unauthorized")


# --- Removal ---


@pytest.mark.parametrize("withdraw", [None, False])
def test_removing_a_file_without_the_flag_keeps_its_mistakes(client, student, db, project, withdraw):
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    answer(client, student["token"], project, quiz_id, question_ids[1], "a")

    assert remove(client, student["token"], project, material_id, withdraw).status_code == 204

    assert outstanding(client, student["token"], project) == 2
    assert all(row[5] is None for row in mistake_rows(db, question_ids))


def test_removing_a_file_with_the_flag_withdraws_its_mistakes(client, student, db, project):
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, correct="b")
    other_quiz, other_questions, _ = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    answer(client, student["token"], project, quiz_id, question_ids[1], "a")
    answer(client, student["token"], project, other_quiz, other_questions[0], "a")

    assert remove(client, student["token"], project, material_id, True).status_code == 204

    # The withdrawn rows stay as history; the other file's Mistake stays outstanding.
    rows = mistake_rows(db, question_ids)
    assert len(rows) == 2 and all(row[5] is not None for row in rows)
    assert summary(client, student["token"], project).json()["outstanding"] == 1


def test_a_failed_removal_with_the_flag_withdraws_nothing(client, student, db, project, monkeypatch):
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")

    withdrawn: list[int] = []
    real_withdraw = mistakes.withdraw_for_material

    async def spy(*args, **kwargs):
        withdrawn.append(await real_withdraw(*args, **kwargs))
        return withdrawn[-1]

    def broken(*_args, **_kwargs):
        # Fails only after the withdrawal ran, inside the same transaction.
        assert withdrawn == [1]
        raise AppError(500, "internal_error", "a later step failed")

    monkeypatch.setattr(mistakes, "withdraw_for_material", spy)
    monkeypatch.setattr(materials, "material_path", broken)
    response = remove(client, student["token"], project, material_id, True)

    assert_error(response, 500, "internal_error")
    # The withdrawal ran (1 row) and was rolled back with the removal.
    assert withdrawn == [1]
    assert db.execute("SELECT removed_at FROM study_materials WHERE id = %s", (material_id,)).fetchone()[0] is None
    assert all(row[5] is None for row in mistake_rows(db, question_ids))
    assert outstanding(client, student["token"], project) == 1


def test_a_repeat_removal_with_the_flag_withdraws(client, student, db, project):
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, correct="b")
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")

    assert remove(client, student["token"], project, material_id).status_code == 204
    assert outstanding(client, student["token"], project) == 1

    assert remove(client, student["token"], project, material_id, True).status_code == 204

    assert outstanding(client, student["token"], project) == 0
    assert mistake_rows(db, question_ids)[0][5] is not None


def test_a_mistake_citing_two_files_counts_under_both_and_leaves_with_either(client, student, db, project):
    quiz_id, question_ids, first = insert_quiz(db, student["id"], project, correct="b")
    _, _, second = insert_quiz(db, student["id"], project, correct="b")
    db.execute("UPDATE quiz_questions SET material_ids = %s::uuid[] WHERE id = %s", ([first, second], question_ids[0]))
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")

    assert summary(client, student["token"], project).json() == {
        "outstanding": 1,
        "by_material": {first: 1, second: 1},
    }

    assert remove(client, student["token"], project, second, True).status_code == 204

    assert summary(client, student["token"], project).json() == {"outstanding": 0, "by_material": {}}
    assert mistake_rows(db, question_ids)[0][5] is not None


def test_a_withdrawal_stays_in_its_project(client, student, db, project):
    # Removing a file withdraws only that Project's Mistakes, even if another Project's cite the same id.
    quiz_id, question_ids, material_id = insert_quiz(db, student["id"], project, correct="b")
    elsewhere = create_project(client, student["token"])
    other_quiz, other_questions, _ = insert_quiz(db, student["id"], elsewhere, correct="b")
    db.execute("UPDATE quiz_questions SET material_ids = %s::uuid[] WHERE id = %s", ([material_id], other_questions[0]))
    answer(client, student["token"], project, quiz_id, question_ids[0], "a")
    answer(client, student["token"], elsewhere, other_quiz, other_questions[0], "a")

    assert remove(client, student["token"], project, material_id, True).status_code == 204

    assert outstanding(client, student["token"], project) == 0
    assert outstanding(client, student["token"], elsewhere) == 1


# --- Boundaries ---


def test_the_mistakes_table_is_closed_to_the_browser_keys(db):
    for role in ("anon", "authenticated"):
        assert not db.execute(
            "SELECT has_table_privilege(%s, 'public.mistakes', 'SELECT, INSERT, UPDATE, DELETE')", (role,)
        ).fetchone()[0]
    assert db.execute("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mistakes'::regclass").fetchone()[0]


def test_only_services_mistakes_uses_the_mistakes_repository():
    # AD-10: only services/mistakes writes the table, through db/mistakes.
    offenders = sorted(
        str(path.relative_to(APP_DIR))
        for path in APP_DIR.rglob("*.py")
        if path.relative_to(APP_DIR).as_posix() not in ("services/mistakes.py", "db/mistakes.py")
        and any(
            marker in path.read_text(encoding="utf-8")
            for marker in ("db import mistakes", "db.mistakes", "INTO mistakes", "UPDATE mistakes")
        )
    )
    assert offenders == []
