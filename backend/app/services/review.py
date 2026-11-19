"""Mistake Review (Stories 3.4 + 3.5: FR-17, FR-18, AD-9, AD-10, AD-11, AD-18, AD-20).

Starting a round (`request`) runs in the request transaction, only on the student's request: the
read-only guard, a refusal when nothing is outstanding (`422 insufficient_material`), then a
`review_round` job and its `review_rounds` row. A partial unique index allows one queued or running
`review_round` job per Project, so a second request gets `409 review_in_progress`.

The job (progress steps "Looking at your mistakes" = reading, "Writing practice questions" = writing):

1. reading: the oldest outstanding Mistakes, at most 20. Each gets, in this order of preference, its
   unanswered Practice Question from an earlier round (reused as it is); the saved original question,
   re-shuffled, when a Material it cites was removed (`from_original`, no model call); or a target for
   the model with its Sections' text;
2. writing: one batched `llm.generate_practice` call, only when there are targets, with no connection
   held (AD-18);
3. checking: each AI item mapped back to its target (a Section number outside the target's own
   Sections is dropped), checked, and shuffled into ids `a`-`d`; an item that is missing, uncited, or has
   a blank or repeated option falls back to the original question;
4. the runner's save transaction inserts the new Practice Questions and the round's items in Mistake age
   order, unless the job was cancelled or the Project deleted (the runner checks both). A Mistake
   cleared or withdrawn meanwhile is skipped; an AI item whose file was removed meanwhile falls back to
   the original question. With nothing left, the job fails with `insufficient_material`.

A provider error fails the job with `llm_unavailable`, invalid output with `llm_output_invalid`.

The session (Story 3.5): `get` serves the round with the answer keys hidden until answered (as for the
Quiz), each item with its Mistake's context (the original question and the wrong answer's text; the
correct answer's text only once answered) and whether a cited file was removed. `answer` scores and saves
one answer, idempotently, with no model call; a correct answer clears the Mistake through
`mistakes.clear` in the same transaction. A wrong answer never creates a Mistake.
Logs carry counts only, never material text.
"""

import logging
import random
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

import psycopg
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import review as repo
from app.db import sections as section_repo
from app.errors import AppError
from app.llm import Gateway, LLMOutputError, PracticeDraft, PracticeTarget, ProviderError, practice_sections
from app.llm.gateway import CHARS_PER_TOKEN
from app.llm.schemas import PRACTICE_MAX
from app.services import jobs, mistakes, projects, questions

logger = logging.getLogger(__name__)

KIND = "review_round"
ROUND_MAX = PRACTICE_MAX

LLM_UNAVAILABLE = "llm_unavailable"
LLM_OUTPUT_INVALID = "llm_output_invalid"
INSUFFICIENT_MATERIAL = "insufficient_material"
ONE_ACTIVE_INDEX = "generation_jobs_one_review_round_idx"
# Each Section's text in a practice prompt is cut to this, and a target's Sections together stay within it.
TARGET_TEXT_CHARS = 4_000


class RoundNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such review round")


class ReviewInProgress(AppError):
    def __init__(self) -> None:
        super().__init__(409, "review_in_progress", "A review round is already being made")


@dataclass(frozen=True)
class _Section:
    """A loaded Section, in the shape the gateway reads (`id`, `label`, `text`)."""

    id: UUID
    material_id: UUID
    label: str
    text: str


# --- In the request ---


async def request(conn: AsyncConnection, account_id: UUID, project_id: UUID) -> tuple[dict[str, Any], UUID]:
    """Queue a `review_round` job and its round (FR-17, AD-11). Returns `(job, round_id)`; the caller
    submits the job after the commit."""
    await projects.require_active(conn, account_id, project_id)
    if await mistakes.outstanding_count(conn, account_id, project_id) == 0:
        raise AppError(422, INSUFFICIENT_MATERIAL, "No outstanding Mistakes to review")
    round_id = uuid4()
    try:
        job = await jobs.enqueue(conn, account_id, project_id, KIND, params={"round_id": str(round_id)})
    except psycopg.errors.UniqueViolation as exc:
        if exc.diag.constraint_name == ONE_ACTIVE_INDEX:
            raise ReviewInProgress() from None
        raise
    await repo.insert_round(conn, round_id, account_id, project_id, job["id"])
    return job, round_id


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, round_id: UUID) -> dict[str, Any]:
    """`{id, status, error_code, items, cleared_count, total, remaining_outstanding}` (FR-18, AD-9, AD-11):
    `status` and `error_code` are the round's job's, so a round still being made (or failed) is told apart
    from a missing one. A read: no guard, so a read-only Project's round still opens."""
    await projects.get(conn, account_id, project_id)
    found = await repo.get_round(conn, account_id, project_id, round_id)
    if found is None:
        raise RoundNotFound()
    rows = await repo.items_for(conn, account_id, round_id)
    answers = await repo.answers_for(conn, account_id, [row["id"] for row in rows])
    answered = [row for row in rows if row["id"] in answers]
    labels = await section_repo.source_labels(conn, account_id, questions.section_ids(answered))
    contexts = await _contexts(conn, account_id, rows)
    cleared = await mistakes.cleared_by(conn, account_id, [stored["id"] for stored in answers.values()])
    return {
        "id": round_id,
        "status": found["status"],
        "error_code": found["error_code"],
        "items": [_item(row, answers.get(row["id"]), labels, contexts[row["mistake_id"]]) for row in rows],
        "cleared_count": sum(1 for stored in answers.values() if stored["id"] in cleared),
        "total": len(rows),
        "remaining_outstanding": await mistakes.outstanding_count(conn, account_id, project_id),
    }


async def answer(
    conn: AsyncConnection,
    account_id: UUID,
    project_id: UUID,
    round_id: UUID,
    practice_question_id: UUID,
    option_id: str,
) -> dict[str, Any]:
    """Score and save one practice answer (FR-18, AD-9): `option_id == correct_option_id`, with no model
    call. A content mutation, so the read-only guard comes first (AD-22). Idempotent: a resubmit returns
    the stored answer. A correct answer clears its Mistake in this same transaction (AD-10); a wrong one
    leaves it outstanding and never creates a Mistake. Returns the answered item plus `cleared`,
    `cleared_count`, and `remaining_outstanding`."""
    await projects.require_active(conn, account_id, project_id)
    row = await repo.item(conn, account_id, project_id, round_id, practice_question_id)
    if row is None:
        raise RoundNotFound()
    stored, _ = await repo.insert_answer(
        conn, account_id, practice_question_id, option_id, option_id == row["correct_option_id"]
    )
    cleared = bool(stored["is_correct"]) and await mistakes.clear(conn, row["mistake_id"], stored["id"])
    labels = await section_repo.source_labels(conn, account_id, list(row["source_section_ids"]))
    contexts = await _contexts(conn, account_id, [row])
    rows = await repo.items_for(conn, account_id, round_id)
    answers = await repo.answers_for(conn, account_id, [item["id"] for item in rows])
    cleared_answers = await mistakes.cleared_by(conn, account_id, [a["id"] for a in answers.values()])
    return {
        **_item(row, stored, labels, contexts[row["mistake_id"]]),
        "cleared": cleared,
        "cleared_count": len(cleared_answers),
        "remaining_outstanding": await mistakes.outstanding_count(conn, account_id, project_id),
    }


async def _contexts(
    conn: AsyncConnection, account_id: UUID, rows: Sequence[dict[str, Any]]
) -> dict[UUID, dict[str, Any]]:
    """By Mistake id: the saved original question, the wrong answer's and the correct answer's text, and
    whether a Material it cites is removed now."""
    snapshots = await mistakes.snapshots(conn, account_id, list(dict.fromkeys(row["mistake_id"] for row in rows)))
    removed = await section_repo.removed_materials(
        conn, list({material_id for snap in snapshots.values() for material_id in snap["material_ids"]})
    )
    contexts = {}
    for mistake_id, snap in snapshots.items():
        original = snap["question_snapshot"]
        texts = {option["id"]: option["text"] for option in original.get("options", [])}
        contexts[mistake_id] = {
            "question": original.get("question", ""),
            "earlier_answer_text": texts.get(snap["submitted_option_id"], ""),
            "correct_text": texts.get(original.get("correct_option_id"), ""),
            "file_removed": any(material_id in removed for material_id in snap["material_ids"]),
        }
    return contexts


def _item(
    row: dict[str, Any], stored: dict[str, Any] | None, labels: dict[UUID, str], context: dict[str, Any]
) -> dict[str, Any]:
    """An item as the student sees it: the answer key, and the original's correct answer, only once
    answered."""
    return {
        **questions.shown(row, stored, labels),
        "context": {
            "question": context["question"],
            "earlier_answer_text": context["earlier_answer_text"],
            "correct_text": context["correct_text"] if stored is not None else None,
        },
        "file_removed": context["file_removed"],
        "from_original": row["from_original"],
    }


# --- Checking (pure) ---


def snapshot_sections(snap: dict[str, Any]) -> list[UUID]:
    """The snapshot's cited Section ids; a value that isn't an id is skipped, not fatal."""
    found = []
    for value in snap.get("source_section_ids") or []:
        try:
            found.append(UUID(str(value)))
        except ValueError:
            continue
    return list(dict.fromkeys(found))


def _normalized(text: str) -> str:
    return " ".join(str(text).split()).casefold()


def original(mistake: dict[str, Any], rng: random.Random) -> dict[str, Any] | None:
    """The Mistake's saved original question, re-shuffled, as a Practice Question (`from_original`).
    None when the snapshot can't make one (it always can for a Quiz Mistake)."""
    snap = mistake["question_snapshot"]
    options = snap.get("options") or []
    texts = [option.get("text", "") for option in options]
    ids = [option.get("id") for option in options]
    sources = snapshot_sections(snap)
    if (
        not questions.usable_options(texts)
        or snap.get("correct_option_id") not in ids
        or not sources
        or not str(snap.get("question", "")).strip()
        or not str(snap.get("explanation", "")).strip()
    ):
        return None
    shuffled, correct_option_id = questions.shuffle(texts, ids.index(snap["correct_option_id"]), rng)
    return {
        "mistake_id": mistake["id"],
        "question": snap["question"],
        "options": shuffled,
        "correct_option_id": correct_option_id,
        "explanation": snap["explanation"],
        "source_section_ids": sources,
        "material_ids": list(mistake["material_ids"]),
        "from_original": True,
    }


def plan_targets(
    fresh: Sequence[dict[str, Any]], loaded: dict[UUID, _Section], budget_tokens: int
) -> list[PracticeTarget]:
    """Targets for the model, oldest Mistake first (AD-3, AD-11). The caller cuts each Section's text to
    `TARGET_TEXT_CHARS`; a target keeps its Sections while their text stays within that (its first
    always). Targets are added while the estimated prompt stays within `budget_tokens`; a Mistake left
    out (or with no loaded Section) is practised from its original."""
    targets: list[PracticeTarget] = []
    sent: set[UUID] = set()
    used = 0
    for m in fresh:
        snap = m["question_snapshot"]
        own: list[_Section] = []
        size = 0
        for section_id in snapshot_sections(snap):
            section = loaded.get(section_id)
            if section is None:
                continue
            if own and size + len(section.text) > TARGET_TEXT_CHARS:
                break
            own.append(section)
            size += len(section.text)
        if not own:
            continue
        texts = {option.get("id"): option.get("text", "") for option in snap.get("options") or []}
        question, correct = str(snap.get("question", "")), str(texts.get(snap.get("correct_option_id"), ""))
        wrong = str(texts.get(m.get("submitted_option_id"), ""))
        cost = len(question) + len(correct) + len(wrong) + sum(len(s.text) for s in own if s.id not in sent)
        if (used + cost) // CHARS_PER_TOKEN > budget_tokens:
            continue
        used += cost
        sent.update(s.id for s in own)
        targets.append(PracticeTarget(m["id"], question, correct, own, wrong))
    return targets


def check(
    draft: PracticeDraft | None,
    targets: Sequence[PracticeTarget],
    sections: Sequence[_Section],
    rng: random.Random,
) -> dict[UUID, dict[str, Any]]:
    """The usable AI items, by Mistake id (AD-7, AD-9): the first item for each target (its `mistake_id`
    parsed as an id), its Section numbers mapped back to ids and kept only when they are the target's
    own, its options usable, its question not the original's, and shuffled into ids `a`-`d`. A target
    with no usable item is left out (the caller uses the original). Logs only how many were dropped."""
    if draft is None:
        return {}
    by_id = {target.mistake_id: target for target in targets}
    kept: dict[UUID, dict[str, Any]] = {}
    dropped = 0
    for item in draft.items:
        try:
            target = by_id.get(UUID(item.mistake_id.strip()))
        except ValueError:
            target = None
        if target is None or target.mistake_id in kept:
            dropped += 1
            continue
        own = {section.id for section in target.sections}
        numbers = dict.fromkeys(n for n in item.sections if 1 <= n <= len(sections))
        cited = [sections[n - 1] for n in numbers if sections[n - 1].id in own]
        if (
            not cited
            or not questions.usable_options(item.options)
            or _normalized(item.question) == _normalized(target.question_text)
        ):
            dropped += 1
            continue
        options, correct_option_id = questions.shuffle(item.options, item.correct_index, rng)
        kept[target.mistake_id] = {
            "mistake_id": target.mistake_id,
            "question": item.question,
            "options": options,
            "correct_option_id": correct_option_id,
            "explanation": item.explanation,
            "source_section_ids": [section.id for section in cited],
            "material_ids": list(dict.fromkeys(section.material_id for section in cited)),
            "from_original": False,
        }
    if dropped:
        logger.info("Review round: dropped %d practice item(s)", dropped)
    return kept


# --- The review_round job (AD-11, AD-20) ---


async def _nothing(_conn: AsyncConnection) -> None:
    return None


def review_kind(pool: AsyncConnectionPool, llm: Gateway, budget_tokens: int) -> jobs.JobKind:
    """The handler for `review_round` jobs. No terminal hook: a failed or cancelled job leaves an empty
    round and every Mistake as it was. `budget_tokens` bounds the practice prompt."""
    rng = random.SystemRandom()

    async def run(job: dict[str, Any], _payload: Any) -> jobs.SavePlan:
        round_id = UUID(str(job["params"]["round_id"]))
        account_id, project_id = job["account_id"], job["project_id"]

        # 1. Reading (the claim already set the step): "Looking at your mistakes". A removed file wins
        # over reuse (AD-11): such a Mistake is practised from its original.
        async with pool.connection() as conn:
            picked = await mistakes.oldest_outstanding(conn, account_id, project_id, ROUND_MAX)
            all_materials = list({material_id for m in picked for material_id in m["material_ids"]})
            removed = await section_repo.removed_materials(conn, all_materials)
            live = [m for m in picked if not any(material_id in removed for material_id in m["material_ids"])]
            reusable = await repo.unanswered_for(conn, account_id, [m["id"] for m in live])
            fresh = [m for m in live if m["id"] not in reusable]
            wanted = list(dict.fromkeys(i for m in fresh for i in snapshot_sections(m["question_snapshot"])))
            rows = await section_repo.load_sections(conn, wanted)
        if not picked:
            raise jobs.JobFailed(INSUFFICIENT_MATERIAL)
        loaded = {
            row["id"]: _Section(row["id"], row["material_id"], row["label"], row["text"][:TARGET_TEXT_CHARS])
            for row in rows
        }
        targets = plan_targets(fresh, loaded, budget_tokens)
        await llm.mock_pause()
        # A cancelled job's result is thrown away: no model call. The save step ends it `cancelled`.
        if await jobs.should_stop(pool, job["id"]):
            return jobs.SavePlan(apply=_nothing)

        # 2. Writing: "Writing practice questions", with no connection held (AD-18).
        await jobs.set_progress(pool, job["id"], jobs.WRITING)
        draft = None
        if targets:
            try:
                draft = await llm.generate_practice(targets)
            except ProviderError:
                raise jobs.JobFailed(LLM_UNAVAILABLE) from None
            except LLMOutputError:
                raise jobs.JobFailed(LLM_OUTPUT_INVALID) from None

        # 3. Checking (no step of its own in Mistake Review).
        generated = check(draft, targets, practice_sections(targets), rng)
        originals = {m["id"]: original(m, rng) for m in picked}
        await llm.mock_pause()
        logger.info(
            "Review round: mistakes=%d reused=%d targets=%d generated=%d",
            len(picked), len(reusable), len(targets), len(generated),
        )

        async def save(conn: AsyncConnection) -> None:
            ids = [m["id"] for m in picked]
            still = await mistakes.outstanding_among(conn, account_id, ids)
            removed_now = await section_repo.removed_materials(conn, all_materials)
            # Re-read here: a Practice Question answered during generation is not reused.
            unanswered = await repo.unanswered_for(conn, account_id, ids)
            items = []
            for m in picked:
                if m["id"] not in still:
                    continue  # cleared or withdrawn meanwhile
                gone = any(material_id in removed_now for material_id in m["material_ids"])
                if not gone and m["id"] in reusable and m["id"] in unanswered:
                    items.append({"practice_question_id": unanswered[m["id"]]})
                    continue
                item = (None if gone else generated.get(m["id"])) or originals[m["id"]]
                if item is not None:
                    items.append(item)
            if not items:
                raise jobs.JobFailed(INSUFFICIENT_MATERIAL)
            await repo.insert_items(conn, account_id, round_id, items)

        return jobs.SavePlan(apply=save, result_ref=round_id)

    return jobs.JobKind(run=run)
