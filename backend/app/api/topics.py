"""Topic edits (FR-22, AD-21, AD-22). Each requires an active Project (`ActiveProject`), runs in the
request transaction with the Material locked, and answers `200 {material_id, topics}` with the file's
whole Topic list in order. Any id outside the URL's Project, or of a removed file, is `404 not_found`.

- `PATCH /api/projects/{project_id}/topics/{topic_id}` `{label}`: rename (trimmed, 1-100 characters,
  else `422 invalid_name`).
- `DELETE /api/projects/{project_id}/topics/{topic_id}`: delete; the last one is `422
  topic_last_cannot_delete`.
- `POST /api/projects/{project_id}/topics/merge` `{topic_ids}`: merge 2+ Topics of one file into the
  one with the lowest position; across files `422 topic_merge_cross_material`.
- `POST /api/projects/{project_id}/materials/{material_id}/topics` `{label}`: add a student Topic,
  placed last; only a Ready file; the 101st is `422 topic_limit_reached`.
"""

from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import ActiveProject, Conn
from app.api.materials import Topic
from app.auth import UserAuth
from app.services import topics

router = APIRouter(prefix="/projects/{project_id}")


class TopicList(BaseModel):
    material_id: UUID
    topics: list[Topic]


class TopicLabel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str


class TopicMerge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic_ids: list[UUID] = Field(min_length=2, max_length=100)


@router.patch("/topics/{topic_id}", response_model=TopicList)
async def rename_topic(topic_id: UUID, body: TopicLabel, project: ActiveProject, user: UserAuth, conn: Conn):
    return await topics.rename(conn, user.account_id, project["id"], topic_id, body.label)


@router.delete("/topics/{topic_id}", response_model=TopicList)
async def delete_topic(topic_id: UUID, project: ActiveProject, user: UserAuth, conn: Conn):
    return await topics.delete(conn, user.account_id, project["id"], topic_id)


@router.post("/topics/merge", response_model=TopicList)
async def merge_topics(body: TopicMerge, project: ActiveProject, user: UserAuth, conn: Conn):
    return await topics.merge(conn, user.account_id, project["id"], body.topic_ids)


@router.post("/materials/{material_id}/topics", response_model=TopicList)
async def add_topic(material_id: UUID, body: TopicLabel, project: ActiveProject, user: UserAuth, conn: Conn):
    return await topics.add(conn, user.account_id, project["id"], material_id, body.label)
