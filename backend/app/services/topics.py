"""Topics (FR-22, AD-21): the target count, detection with server-side repair, and the save.

`target_count` is the only place a Topic count is computed; the client never sends one. `detect` runs
in the processing job with no connection held (AD-18); `save` runs inside the job's save transaction,
with the Sections and `ready`, and never commits.

The model's reply is repaired here rather than retried (only output with the wrong shape fails, inside
the gateway): Section numbers the file doesn't have are dropped, a Topic left with none is dropped,
Topics are ordered by the first Section they cover and cut to 100, and every Section no Topic covers
joins the Topic before it (the first Topic, for Sections before any). A reply with fewer Topics than
the target is kept, never padded with made-up ones.

Student edits (Story 2.6b): `rename`, `delete`, `merge`, and `add`. Each runs in the request
transaction: the read-only guard (`projects.require_active`), then the Material row locked FOR UPDATE,
so edits of one file run one at a time. Each returns the Material's whole Topic list. Every Section
keeps at least one Topic: a merge keeps all links on the surviving Topic, and a delete hands the
Sections only the deleted Topic covered to its neighbour (the Topic before it, else the one after).

Scope resolution (Epic 3, AD-7): `resolve_scope` is the only resolver of a Selection Scope, for every
generator and for the capacity endpoint. It only reads; the caller guards and freezes the result.

Logs carry counts only, never labels or text.
"""

import logging
import math
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from psycopg import AsyncConnection

from app.db import materials as materials_repo
from app.db import topics as repo
from app.errors import AppError
from app.extraction import Extracted
from app.extraction.text import count_words
from app.llm import DetectedTopics, Gateway, LLMOutputError
from app.llm.gateway import estimate_tokens, items_for
from app.llm.schemas import TOPICS_MAX
from app.services import projects

logger = logging.getLogger(__name__)

TOPICS_MIN = 3
PAGES_PER_TOPIC = 5
WORDS_PER_PAGE = 500
LABEL_MAX_LENGTH = 100


class TopicNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "not_found", "No such Topic or file")


class TopicLastCannotDelete(AppError):
    def __init__(self) -> None:
        super().__init__(422, "topic_last_cannot_delete", "A file needs at least one Topic")


class TopicMergeCrossMaterial(AppError):
    def __init__(self) -> None:
        super().__init__(422, "topic_merge_cross_material", "Only Topics of the same file can be merged")


class TopicLimitReached(AppError):
    def __init__(self) -> None:
        super().__init__(422, "topic_limit_reached", "A file has at most 100 Topics", {"max": TOPICS_MAX})


class InvalidMergeRequest(AppError):
    def __init__(self) -> None:
        super().__init__(422, "invalid_request", "A merge needs at least two different Topics", {"fields": ["topic_ids"]})


class InsufficientMaterial(AppError):
    def __init__(self) -> None:
        super().__init__(422, "insufficient_material", "There is no Ready material in this scope")


class ScopeTooLarge(AppError):
    def __init__(self, budget_tokens: int) -> None:
        super().__init__(422, "scope_too_large", "The scope is over the context budget", {"max_tokens": budget_tokens})


@dataclass(frozen=True)
class ResolvedScope:
    """A Selection Scope resolved to Sections (AD-7). `section_ids`, `topic_labels`, `material_ids`, and
    `est_tokens` are the spine's fields; `words` feeds the capacity estimate."""

    section_ids: tuple[UUID, ...]
    topic_labels: tuple[str, ...]
    material_ids: tuple[UUID, ...]
    est_tokens: int
    words: int

    def max_items(self, words_per_item: int) -> int:
        """The capacity (AD-7): `max(sections, words // words_per_item)`, at most 20."""
        return items_for(len(self.section_ids), self.words, words_per_item)

    def require_within(self, budget_tokens: int) -> None:
        """`422 scope_too_large` when the material is over the context budget (AD-7)."""
        if self.est_tokens > budget_tokens:
            raise ScopeTooLarge(budget_tokens)


@dataclass(frozen=True)
class TopicDraft:
    """A Topic before it is saved: its label, group, and the 0-based positions of its Sections."""

    label: str
    group_label: str | None
    sections: tuple[int, ...]


def page_count(extracted: Extracted) -> int:
    """Sections for paged files (a PDF page, a slide), else `ceil(words / 500)` (AD-21)."""
    if extracted.paged:
        return len(extracted.sections)
    words = sum(count_words(section.text) for section in extracted.sections)
    return math.ceil(words / WORDS_PER_PAGE)


def target_count(extracted: Extracted) -> int:
    """`clamp(ceil(pages / 5), 3, 100)` (AD-21)."""
    return min(TOPICS_MAX, max(TOPICS_MIN, math.ceil(page_count(extracted) / PAGES_PER_TOPIC)))


def repair(detected: DetectedTopics, section_count: int) -> list[TopicDraft]:
    """Drafts covering every one of `section_count` Sections, at most 100 (see the module docstring).
    Raises `LLMOutputError` when no Topic names a Section the file has."""
    kept: list[tuple[str, str | None, list[int]]] = []
    for topic in detected.topics:
        positions = sorted({number - 1 for number in topic.sections if 1 <= number <= section_count})
        if positions:
            kept.append((topic.label, topic.group_label, positions))
    if not kept:
        raise LLMOutputError("No Topic covers a Section of the file")
    # Ordered by the first Section covered; ties keep the model's order (the sort is stable).
    kept.sort(key=lambda topic: topic[2][0])
    kept = kept[:TOPICS_MAX]

    covered = {position for _, _, positions in kept for position in positions}
    owner = 0  # the Topic a skipped Section joins: the last one starting at or before it
    for position in range(section_count):
        while owner + 1 < len(kept) and kept[owner + 1][2][0] <= position:
            owner += 1
        if position not in covered:
            kept[owner][2].append(position)
    return [TopicDraft(label, group, tuple(sorted(positions))) for label, group, positions in kept]


async def detect(llm: Gateway, extracted: Extracted) -> list[TopicDraft]:
    """Detect the Topics of an extracted file (no connection held). Gateway errors propagate, which
    fails the job (the Material is then rejected as `processing_failed`)."""
    target = target_count(extracted)
    detected = await llm.detect_topics(extracted.sections, target)
    drafts = repair(detected, len(extracted.sections))
    logger.info("Topics: target=%d returned=%d saved=%d", target, len(detected.topics), len(drafts))
    return drafts


async def save(conn: AsyncConnection, material_id: UUID, drafts: list[TopicDraft], section_ids: list[UUID]) -> None:
    """Insert the drafts and their Section links in the caller's transaction. `section_ids[i]` is the
    id of the Section at position `i`."""
    if not drafts:
        raise ValueError("a Ready Material needs Topics")
    rows: list[tuple[UUID, str, str | None]] = []
    links: list[tuple[UUID, UUID]] = []
    for draft in drafts[:TOPICS_MAX]:
        topic_id = uuid4()
        rows.append((topic_id, draft.label, draft.group_label))
        links.extend((topic_id, section_ids[position]) for position in draft.sections)
    await repo.insert_many(conn, material_id, rows, links)


async def list_for_materials(conn: AsyncConnection, material_ids: list[UUID]) -> dict[UUID, list[dict]]:
    """Each Material's Topics (`id`, `label`, `group_label`, `position`), in order."""
    grouped: dict[UUID, list[dict]] = {material_id: [] for material_id in material_ids}
    for row in await repo.list_for_materials(conn, material_ids):
        material_id = row.pop("material_id")
        grouped.setdefault(material_id, []).append(row)
    return grouped


# --- Student edits (Story 2.6b, FR-22, AD-21) ---


def clean_label(raw: str) -> str:
    """Whitespace runs (newlines, tabs) collapsed to single spaces and trimmed, then 1-100 characters;
    anything else is `422 invalid_name` (longer labels are refused, not cut)."""
    label = " ".join(raw.split())
    if not label or len(label) > LABEL_MAX_LENGTH:
        raise projects.InvalidName()
    return label


async def _lock_material(conn: AsyncConnection, account_id: UUID, project_id: UUID, material_id: UUID) -> dict:
    """The Material, locked FOR UPDATE; `404` unless it is in this Project and not removed."""
    material = await materials_repo.get_for_update(conn, account_id, material_id)
    if material is None or material["project_id"] != project_id or material["removed_at"] is not None:
        raise TopicNotFound()
    return material


async def _locked_topics(conn: AsyncConnection, account_id: UUID, project_id: UUID, topic_ids: list[UUID]) -> list[dict]:
    """The Topics, read again under their Material's lock, so a concurrent edit can't slip in between.
    `404` when any id is missing or foreign; `422 topic_merge_cross_material` when they span files."""
    found = await repo.get_many(conn, account_id, project_id, topic_ids)
    if len(found) != len(topic_ids):
        raise TopicNotFound()
    material_ids = {row["material_id"] for row in found}
    if len(material_ids) > 1:
        raise TopicMergeCrossMaterial()
    await _lock_material(conn, account_id, project_id, material_ids.pop())
    found = await repo.get_many(conn, account_id, project_id, topic_ids)
    if len(found) != len(topic_ids):
        raise TopicNotFound()
    return found


async def _result(conn: AsyncConnection, material_id: UUID) -> dict:
    return {"material_id": material_id, "topics": (await list_for_materials(conn, [material_id]))[material_id]}


async def rename(conn: AsyncConnection, account_id: UUID, project_id: UUID, topic_id: UUID, raw_label: str) -> dict:
    await projects.require_active(conn, account_id, project_id)
    label = clean_label(raw_label)
    (topic,) = await _locked_topics(conn, account_id, project_id, [topic_id])
    await repo.update_label(conn, topic_id, label)
    return await _result(conn, topic["material_id"])


async def delete(conn: AsyncConnection, account_id: UUID, project_id: UUID, topic_id: UUID) -> dict:
    """Delete a Topic, never the last one. Sections only it covered move to its neighbour."""
    await projects.require_active(conn, account_id, project_id)
    (topic,) = await _locked_topics(conn, account_id, project_id, [topic_id])
    material_id = topic["material_id"]
    siblings = [row["id"] for row in await repo.list_for_materials(conn, [material_id])]
    if len(siblings) <= 1:
        raise TopicLastCannotDelete()
    index = siblings.index(topic_id)
    heir = siblings[index - 1] if index > 0 else siblings[index + 1]
    await repo.relink(conn, heir, [topic_id], orphans_only=True)
    await repo.delete(conn, [topic_id])
    return await _result(conn, material_id)


async def merge(conn: AsyncConnection, account_id: UUID, project_id: UUID, topic_ids: list[UUID]) -> dict:
    """Merge 2+ Topics of one file into the one with the lowest position, which keeps its id, label,
    and group and takes the union of their Sections; the others are deleted."""
    await projects.require_active(conn, account_id, project_id)
    distinct = list(dict.fromkeys(topic_ids))
    if len(distinct) < 2:
        raise InvalidMergeRequest()
    found = await _locked_topics(conn, account_id, project_id, distinct)
    survivor, *others = sorted(found, key=lambda row: row["position"])
    other_ids = [row["id"] for row in others]
    await repo.relink(conn, survivor["id"], other_ids)
    await repo.delete(conn, other_ids)
    return await _result(conn, survivor["material_id"])


async def add(conn: AsyncConnection, account_id: UUID, project_id: UUID, material_id: UUID, raw_label: str) -> dict:
    """A student Topic, with no Sections and no group, placed last. Only a Ready file takes one."""
    await projects.require_active(conn, account_id, project_id)
    label = clean_label(raw_label)
    material = await _lock_material(conn, account_id, project_id, material_id)
    if material["status"] != "ready":
        raise TopicNotFound()
    if await repo.count(conn, material_id) >= TOPICS_MAX:
        raise TopicLimitReached()
    last = await repo.max_position(conn, material_id)
    await repo.insert_one(conn, material_id, label, 0 if last is None else last + 1)
    return await _result(conn, material_id)


# --- Scope resolution (AD-7) ---


async def resolve_scope(
    conn: AsyncConnection, account_id: UUID, project_id: UUID, scope: dict[str, Any]
) -> ResolvedScope:
    """Resolve `{"all_topics": true}` or `{"topic_ids": [...]}` to Sections (AD-7).

    - `all_topics`: every Section of every Ready, non-removed Material; no focus labels.
    - `topic_ids`: the Topics' Sections; a student Topic with no Sections stands for its whole Material.
      Every chosen Topic's label is passed on as the focus.
    A missing or foreign Project or Topic id, or one of a removed or not-Ready file, is `404 not_found`; a
    scope with no Sections is `422 insufficient_material`. Removed Materials are never in scope.
    """
    await projects.get(conn, account_id, project_id)
    if scope.get("all_topics") is True:
        rows = await repo.scope_sections_all(conn, account_id, project_id)
        labels: list[str] = []
    else:
        topic_ids = list(dict.fromkeys(scope.get("topic_ids") or []))
        found = await repo.get_many(conn, account_id, project_id, topic_ids) if topic_ids else []
        if not topic_ids or len(found) != len(topic_ids) or any(row["material_status"] != "ready" for row in found):
            raise TopicNotFound()
        empty = await repo.topics_without_sections(conn, topic_ids)
        whole = list({row["material_id"] for row in found if row["id"] in empty})
        rows = await repo.scope_sections_of(conn, account_id, project_id, topic_ids, whole)
        by_id = {row["id"]: row for row in found}
        labels = [by_id[topic_id]["label"] for topic_id in topic_ids]
    if not rows:
        raise InsufficientMaterial()
    texts = [row["text"] for row in rows]
    resolved = ResolvedScope(
        section_ids=tuple(row["id"] for row in rows),
        topic_labels=tuple(labels),
        material_ids=tuple(dict.fromkeys(row["material_id"] for row in rows)),
        est_tokens=estimate_tokens(texts),
        words=sum(count_words(text) for text in texts),
    )
    logger.info(
        "Scope: sections=%d materials=%d est_tokens=%d", len(rows), len(resolved.material_ids), resolved.est_tokens
    )
    return resolved
