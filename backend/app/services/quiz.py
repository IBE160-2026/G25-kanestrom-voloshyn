"""Quiz generation (Story 3.1a: FR-10, FR-26, AD-7, AD-9, AD-18, AD-20).

The request (`request`) runs in the request transaction: the read-only guard, then the scope resolved
once (`topics.resolve_scope`) and checked against the context budget, then a `quiz` job whose params
freeze `{count, section_ids, topic_labels}`. The frozen count is the one asked for (5, 10, or 20) cut to
the scope's capacity, the same estimate the capacity endpoint gives. The job uses only those params:

1. reading: load the Sections (a short read); when a Material of the scope was removed or a cancel was
   requested meanwhile, stop here, before the model call, and the save step ends the job `cancelled`;
2. writing: `llm.generate_quiz` with no connection held (AD-18);
3. checking: map `S1…Sn` back to Section ids, drop uncited questions and those whose options are blank
   or not all different, keep at most `count`, and shuffle each question's 4 options into ids `a`-`d`
   (AD-9);
4. the runner's save transaction inserts the Quiz and its Questions, unless the job was cancelled, the
   Project deleted, or a Material of the scope removed. Archived Projects still save (AD-20).

A provider error fails the job with `llm_unavailable`, invalid output with `llm_output_invalid`, and no
usable question with `insufficient_material`.

Taking the Quiz (Story 3.2): `get` serves the Questions with the answer key hidden until answered, and
`answer` scores and saves one answer, idempotently, with no model call; a newly saved wrong answer
becomes a Mistake through `mistakes.record_failure` in the same transaction (Story 3.3).
Logs carry counts only, never material text.
"""

import logging
import random
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import quizzes as repo
from app.db import sections as section_repo
from app.errors import AppError
from app.llm import Gateway, LLMOutputError, ProviderError, QuizDraft
from app.llm.schemas import QUIZ_MAX
from app.services import jobs, mistakes, projects, questions, topics

logger = logging.getLogger(__name__)

KIND = "quiz"
COUNTS = (5, 10, 20)
OPTION_IDS = questions.OPTION_IDS

LLM_UNAVAILABLE = "llm_unavailable"
LLM_OUTPUT_INVALID = "llm_output_invalid"
INSUFFICIENT_MATERIAL = "insufficient_material"


class QuizNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such Quiz")


class MaterialRemoved(AppError):
    """"Do it again" on a result whose source file was removed since (FR-25)."""

    def __init__(self) -> None:
        super().__init__(409, "material_removed", "A file this came from was removed")


async def source_removed(conn: AsyncConnection, account_id: UUID, generation_params: dict[str, Any] | None) -> bool:
    """True when a Material behind the frozen Sections is removed or gone (a plain read, no lock)."""
    return await section_repo.any_section_removed(
        conn, account_id, section_repo.frozen_section_ids(generation_params)
    )


async def again_params(
    conn: AsyncConnection, account_id: UUID, generation_params: dict[str, Any] | None
) -> dict[str, Any]:
    """The params for "Do it again": the artifact's frozen `generation_params`, unchanged and never
    resolved again (AD-7). A removed source refuses it (`409 material_removed`)."""
    if await source_removed(conn, account_id, generation_params):
        raise MaterialRemoved()
    return dict(generation_params or {})


@dataclass(frozen=True)
class _Section:
    """A loaded Section, in the shape the gateway reads (`text`, `label`)."""

    id: UUID
    material_id: UUID
    label: str
    text: str


# --- In the request ---


async def capacity(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, scope: dict[str, Any], words_per_item: int
) -> int:
    """`max_questions` for a scope (AD-7): deterministic, no model call. A read: no guard."""
    resolved = await topics.resolve_scope(conn, account_id, project_id, scope)
    return resolved.max_items(words_per_item)


async def request(
    conn: AsyncConnection,
    account_id: UUID,
    project_id: UUID,
    scope: dict[str, Any],
    count: int,
    budget_tokens: int,
    words_per_item: int,
) -> dict[str, Any]:
    """Queue a `quiz` job (FR-10). Returns the job; the caller submits it after the commit."""
    await projects.require_active(conn, account_id, project_id)
    if count not in COUNTS:
        raise AppError(422, "invalid_request", "count must be 5, 10, or 20", {"fields": ["count"]})
    resolved = await topics.resolve_scope(conn, account_id, project_id, scope)
    resolved.require_within(budget_tokens)
    params = {
        "count": min(count, resolved.max_items(words_per_item)),
        "section_ids": [str(section_id) for section_id in resolved.section_ids],
        "topic_labels": list(resolved.topic_labels),
    }
    return await jobs.enqueue(conn, account_id, project_id, KIND, params=params)


async def again(conn: AsyncConnection, account_id: UUID, project_id: UUID, quiz_id: UUID) -> dict[str, Any]:
    """"Do it again" (FR-25): queue a `quiz` job from the Quiz's frozen `generation_params`, unchanged.
    The guard first (AD-22); a foreign or missing Quiz is `404`, a removed source `409 material_removed`.
    The Quiz itself is never changed. Returns the job; the caller submits it after the commit."""
    await projects.require_active(conn, account_id, project_id)
    found = await repo.get(conn, account_id, project_id, quiz_id)
    if found is None:
        raise QuizNotFound()
    params = await again_params(conn, account_id, found["generation_params"])
    return await jobs.enqueue(conn, account_id, project_id, KIND, params=params)


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, quiz_id: UUID) -> dict[str, Any]:
    """`{id, requested_count, question_count, source_removed, questions}` (FR-11, FR-25, AD-9). A read: no
    guard, so a read-only Project's Quiz still opens. An unanswered Question carries no answer key, explanation, or sources;
    an answered one carries `answer`."""
    await projects.get(conn, account_id, project_id)
    quiz = await repo.get(conn, account_id, project_id, quiz_id)
    if quiz is None:
        raise QuizNotFound()
    rows = await repo.questions_for(conn, account_id, quiz_id)
    answers = await repo.answers_for(conn, account_id, [row["id"] for row in rows])
    answered = [row for row in rows if row["id"] in answers]
    labels = await section_repo.source_labels(conn, account_id, questions.section_ids(answered))
    return {
        **quiz,
        "source_removed": await source_removed(conn, account_id, quiz["generation_params"]),
        "questions": [questions.shown(row, answers.get(row["id"]), labels) for row in rows],
    }


async def answer(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, quiz_id: UUID, question_id: UUID, option_id: str
) -> dict[str, Any]:
    """Score and save one answer (FR-11, AD-9): `option_id == correct_option_id`, with no model call.
    A content mutation, so the read-only guard comes first (AD-22). Idempotent: when the Question already
    has an answer, the stored one is returned unchanged, whatever option was sent now. `option_id` is
    already one of a-d (the request model owns that rule). A newly saved wrong answer is recorded as a
    Mistake (Story 3.3). Returns the answered Question."""
    await projects.require_active(conn, account_id, project_id)
    row = await repo.question(conn, account_id, project_id, quiz_id, question_id)
    if row is None:
        raise QuizNotFound()
    stored, inserted = await repo.insert_answer(
        conn, account_id, question_id, option_id, option_id == row["correct_option_id"]
    )
    # A newly saved wrong answer becomes a Mistake in this same transaction (FR-12, AD-10); a resubmit
    # returns the stored answer and records nothing.
    if inserted and not stored["is_correct"]:
        await mistakes.record_failure(conn, account_id, project_id, question_id, stored["id"])
    labels = await section_repo.source_labels(conn, account_id, list(row["source_section_ids"]))
    return questions.shown(row, stored, labels)


# --- Checking (pure) ---


def check(draft: QuizDraft, sections: Sequence[_Section], count: int, rng: random.Random) -> list[dict[str, Any]]:
    """The questions to save, in order (AD-7, AD-9): Section numbers mapped back to ids (unknown numbers
    dropped), uncited questions dropped, questions with a blank option or two options alike (ignoring
    case and surrounding space) dropped, at most `count` (never more than 20), and each question's
    options shuffled into ids `a`-`d` with the correct one's id recorded."""
    kept: list[dict[str, Any]] = []
    for draft_question in draft.questions:
        if len(kept) >= min(count, QUIZ_MAX):
            break
        numbers = dict.fromkeys(n for n in draft_question.sections if 1 <= n <= len(sections))
        cited = [sections[n - 1] for n in numbers]
        if not cited:
            continue
        if not questions.usable_options(draft_question.options):
            continue
        options, correct_option_id = questions.shuffle(draft_question.options, draft_question.correct_index, rng)
        kept.append(
            {
                "question": draft_question.question,
                "options": options,
                "correct_option_id": correct_option_id,
                "explanation": draft_question.explanation,
                "source_section_ids": [section.id for section in cited],
                "material_ids": list(dict.fromkeys(section.material_id for section in cited)),
            }
        )
    return kept


# --- The quiz job (AD-20) ---


async def _nothing(_conn: AsyncConnection) -> None:
    return None


def quiz_kind(pool: AsyncConnectionPool, llm: Gateway) -> jobs.JobKind:
    """The handler for `quiz` jobs. It has no terminal hook: a failed or cancelled job leaves nothing."""
    rng = random.SystemRandom()

    async def run(job: dict[str, Any], _payload: Any) -> jobs.SavePlan:
        params = job["params"]
        count = int(params["count"])
        section_ids = [UUID(value) for value in params["section_ids"]]
        topic_labels = list(params.get("topic_labels") or [])

        # 1. Reading (the claim already set the step).
        async with pool.connection() as conn:
            rows = await section_repo.load_sections(conn, section_ids)
        sections = [_Section(row["id"], row["material_id"], row["label"], row["text"]) for row in rows]
        material_ids = tuple(dict.fromkeys(section.material_id for section in sections))
        await llm.mock_pause()
        # A removed file's text is blank, and a cancelled job's result is thrown away: no model call. The
        # save step sees the removal or the cancel and ends the job `cancelled`.
        async with pool.connection() as conn:
            removed = await section_repo.any_removed(conn, list(material_ids))
        if removed or await jobs.should_stop(pool, job["id"]):
            return jobs.SavePlan(apply=_nothing, material_ids=material_ids)

        # 2. Writing, with no connection held (AD-18).
        await jobs.set_progress(pool, job["id"], jobs.WRITING)
        try:
            draft = await llm.generate_quiz(sections, count, topic_labels)
        except ProviderError:
            raise jobs.JobFailed(LLM_UNAVAILABLE) from None
        except LLMOutputError:
            raise jobs.JobFailed(LLM_OUTPUT_INVALID) from None

        # 3. Checking.
        await jobs.set_progress(pool, job["id"], jobs.CHECKING)
        questions = check(draft, sections, count, rng)
        await llm.mock_pause()
        logger.info("Quiz: requested=%d returned=%d kept=%d", count, len(draft.questions), len(questions))
        if not questions:
            raise jobs.JobFailed(INSUFFICIENT_MATERIAL)

        quiz_id = uuid4()

        async def save(conn: AsyncConnection) -> None:
            await repo.insert(
                conn,
                quiz_id=quiz_id,
                account_id=job["account_id"],
                project_id=job["project_id"],
                job_id=job["id"],
                generation_params=params,
                requested_count=count,
                questions=questions,
            )

        # Every Material of the scope: removing any of them before the save saves nothing (AD-20).
        return jobs.SavePlan(apply=save, material_ids=material_ids, result_ref=quiz_id)

    return jobs.JobKind(run=run)
