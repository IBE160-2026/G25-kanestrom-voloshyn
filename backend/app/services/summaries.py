"""Summaries (Story 4.3: FR-15, AD-7, AD-8, AD-18, AD-20).

The request (`request`) follows the flashcards pattern: the read-only guard, then the scope resolved
once through `topics.resolve_scope` and checked against the context budget, then a `summary` job whose
params freeze `{material_id, topic_id, file_name, section_ids, topic_labels}`. The whole file resolves
`{"material_id": M}`; one Topic resolves `{"topic_ids": [T]}`, and T must belong to M (`404` otherwise).
There is no count. The job uses only those params:

1. reading: load the Sections; when the file was removed or a cancel was requested meanwhile, stop
   before the model call, and the save step ends the job `cancelled`;
2. writing: `llm.summarize` with no connection held (AD-18);
3. checking: map `S1…Sn` back to Section ids, drop uncited sections and those with a blank heading or
   text;
4. the runner's save transaction inserts the summary and its sections, unless the job was cancelled, the
   Project deleted, or a cited Material removed. Archived Projects still save (AD-20).

A provider error fails the job with `llm_unavailable`, invalid output with `llm_output_invalid`, and no
usable section with `insufficient_material`. A Retry is a new job. Summaries are insert-only (AD-8): no
edit, no regeneration in place. Logs carry counts only, never material text.
"""

import logging
from collections.abc import Sequence
from typing import Any
from uuid import UUID, uuid4

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.db import sections as section_repo
from app.db import summaries as repo
from app.db import topics as topics_repo
from app.errors import AppError
from app.llm import Gateway, LLMOutputError, ProviderError, SummaryDraft
from app.llm.schemas import SUMMARY_SECTIONS_MAX
from app.services import jobs, projects, topics
from app.services.quiz import INSUFFICIENT_MATERIAL, LLM_OUTPUT_INVALID, LLM_UNAVAILABLE, _Section

logger = logging.getLogger(__name__)

KIND = "summary"


class SummaryNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such summary")


# --- In the request ---


async def request(
    conn: AsyncConnection,
    account_id: UUID,
    project_id: UUID,
    material_id: UUID,
    topic_id: UUID | None,
    budget_tokens: int,
) -> dict[str, Any]:
    """Queue a `summary` job (FR-15). Returns the job; the caller submits it after the commit."""
    await projects.require_active(conn, account_id, project_id)
    if topic_id is None:
        scope: dict[str, Any] = {"material_id": material_id}
    else:
        topic = await topics_repo.get(conn, account_id, project_id, topic_id)
        if topic is None or topic["material_id"] != material_id:
            raise topics.TopicNotFound()
        scope = {"topic_ids": [topic_id]}
    resolved = await topics.resolve_scope(conn, account_id, project_id, scope)
    resolved.require_within(budget_tokens)
    material = await topics_repo.ready_material(conn, account_id, project_id, material_id)
    if material is None:  # resolved above, so only a file removed in between
        raise topics.TopicNotFound()
    params = {
        "material_id": str(material_id),
        "topic_id": str(topic_id) if topic_id is not None else None,
        "file_name": material["file_name"],
        "section_ids": [str(section_id) for section_id in resolved.section_ids],
        "topic_labels": list(resolved.topic_labels),
    }
    return await jobs.enqueue(conn, account_id, project_id, KIND, params=params)


# --- Reading a summary ---


async def get(conn: AsyncConnection, account_id: UUID, project_id: UUID, summary_id: UUID) -> dict[str, Any]:
    """`{id, title, file_name, topic_label, sections: [{heading, text, sources: [{label}]}]}`. A read: no
    guard, so a read-only Project's summary still opens. `file_name` and `topic_label` are the frozen
    params; each source label reads "file · label"."""
    await projects.get(conn, account_id, project_id)
    found = await repo.get(conn, account_id, project_id, summary_id)
    if found is None:
        raise SummaryNotFound()
    params = found["generation_params"] if isinstance(found["generation_params"], dict) else {}
    labels_of_topic = [label for label in params.get("topic_labels") or [] if isinstance(label, str)]
    rows = await repo.sections(conn, account_id, summary_id)
    section_ids = list(dict.fromkeys(section_id for row in rows for section_id in row["source_section_ids"]))
    labels = await section_repo.source_labels(conn, account_id, section_ids)
    return {
        "id": found["id"],
        "title": found["title"],
        "file_name": params.get("file_name") or "",
        "topic_label": labels_of_topic[0] if labels_of_topic else None,
        "sections": [
            {
                "heading": row["heading"],
                "text": row["text"],
                "sources": [
                    {"label": label}
                    for label in dict.fromkeys(labels[s] for s in row["source_section_ids"] if s in labels)
                ],
            }
            for row in rows
        ],
    }


# --- Checking (pure) ---


def check(draft: SummaryDraft, sections: Sequence[_Section]) -> list[dict[str, Any]]:
    """The sections to save, in order (AD-7): Section numbers mapped back to ids (unknown numbers
    dropped), uncited sections and sections with a blank heading or text dropped, at most 8. Heading and
    text are saved stripped of surrounding space."""
    kept: list[dict[str, Any]] = []
    for part in draft.sections[:SUMMARY_SECTIONS_MAX]:
        heading, text = part.heading.strip(), part.text.strip()
        if not heading or not text:
            continue
        numbers = dict.fromkeys(n for n in part.sections if 1 <= n <= len(sections))
        cited = [sections[n - 1] for n in numbers]
        if not cited:
            continue
        kept.append(
            {
                "heading": heading,
                "text": text,
                "source_section_ids": [section.id for section in cited],
                "material_ids": list(dict.fromkeys(section.material_id for section in cited)),
            }
        )
    return kept


# --- The summary job (AD-20) ---


async def _nothing(_conn: AsyncConnection) -> None:
    return None


def summary_kind(pool: AsyncConnectionPool, llm: Gateway) -> jobs.JobKind:
    """The handler for `summary` jobs. No terminal hook: a failed or cancelled job leaves nothing."""

    async def run(job: dict[str, Any], _payload: Any) -> jobs.SavePlan:
        params = job["params"]
        section_ids = [UUID(value) for value in params["section_ids"]]
        topic_labels = list(params.get("topic_labels") or [])

        # 1. Reading (the claim already set the step).
        async with pool.connection() as conn:
            rows = await section_repo.load_sections(conn, section_ids)
        sections = [_Section(row["id"], row["material_id"], row["label"], row["text"]) for row in rows]
        material_ids = tuple(dict.fromkeys(section.material_id for section in sections))
        await llm.mock_pause()
        # A removed file's text is blank, and a cancelled job's result is thrown away: no model call.
        async with pool.connection() as conn:
            removed = await section_repo.any_removed(conn, list(material_ids))
        if removed or await jobs.should_stop(pool, job["id"]):
            return jobs.SavePlan(apply=_nothing, material_ids=material_ids)

        # 2. Writing, with no connection held (AD-18).
        await jobs.set_progress(pool, job["id"], jobs.WRITING)
        try:
            draft = await llm.summarize(sections, topic_labels)
        except ProviderError:
            raise jobs.JobFailed(LLM_UNAVAILABLE) from None
        except LLMOutputError:
            raise jobs.JobFailed(LLM_OUTPUT_INVALID) from None

        # 3. Checking.
        await jobs.set_progress(pool, job["id"], jobs.CHECKING)
        kept = check(draft, sections)
        await llm.mock_pause()
        logger.info("Summary: returned=%d kept=%d", len(draft.sections), len(kept))
        if not kept:
            raise jobs.JobFailed(INSUFFICIENT_MATERIAL)

        summary_id = uuid4()
        title = draft.title

        async def save(conn: AsyncConnection) -> None:
            await repo.insert(
                conn,
                summary_id=summary_id,
                account_id=job["account_id"],
                project_id=job["project_id"],
                job_id=job["id"],
                generation_params=params,
                title=title,
                sections=kept,
            )

        # The file's Materials: removing it before the save saves nothing (AD-20).
        return jobs.SavePlan(apply=save, material_ids=material_ids, result_ref=summary_id)

    return jobs.JobKind(run=run)
