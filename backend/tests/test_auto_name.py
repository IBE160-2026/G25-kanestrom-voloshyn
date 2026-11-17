"""A Project names itself from its first Ready file (Story 2.4b, FR-4, AD-14, AD-18).

Runs through a real upload and `material_processing` job in mock mode. Needs local Supabase, like
test_materials.py.
"""

import asyncio
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.llm import LLMOutputError, ProviderUnavailable
from app.llm.gateway import Gateway
from app.main import create_app
from app.services import materials, projects
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    bearer,
    client,
    created,
    db,
    gotrue,
    settings,
)
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    stored_objects,
    student,
    upload,
    upload_and_wait,
    wait_for,
    wait_until_done,
)

NOTES = "photosynthesis-notes.md"
NOTES_NAME = "Photosynthesis: Study Notes"
NORWEGIAN = "fotosyntese-notater.md"
NORWEGIAN_NAME = "Fotosyntese: kortnotater"


@pytest.fixture
def naming(monkeypatch) -> SimpleNamespace:
    """Counts model calls and finished naming attempts (the attempt trails the job's commit)."""
    seen = SimpleNamespace(model_calls=0, attempts=[])
    real_name_project = Gateway.name_project
    real_auto_name = projects.auto_name_if_unnamed

    async def counting_name_project(self, sections):
        seen.model_calls += 1
        return await real_name_project(self, sections)

    async def recording_auto_name(*args, **kwargs):
        result = await real_auto_name(*args, **kwargs)
        seen.attempts.append(result)
        return result

    monkeypatch.setattr(Gateway, "name_project", counting_name_project)
    monkeypatch.setattr(projects, "auto_name_if_unnamed", recording_auto_name)
    return seen


def name_of(db, project_id: str) -> tuple[str | None, str | None]:
    return db.execute("SELECT name, name_source FROM projects WHERE id = %s", (project_id,)).fetchone()


def ready(client, token: str, project_id: str, file_name: str, naming: SimpleNamespace) -> dict:
    """Upload a file, wait until it is Ready and its naming attempt has finished."""
    before = len(naming.attempts)
    material = upload_and_wait(client, token, project_id, file_name)
    assert material["status"] == "ready", material
    wait_for(lambda: len(naming.attempts) == before + 1)
    return material


def test_first_ready_file_names_the_project(client, student, db, naming):
    project_id = create_project(client, student["token"])

    ready(client, student["token"], project_id, NOTES, naming)

    assert name_of(db, project_id) == (NOTES_NAME, "auto")
    assert naming.model_calls == 1
    response = client.get(f"/api/projects/{project_id}", headers=bearer(student["token"]))
    assert response.json()["name"] == NOTES_NAME


def test_an_auto_named_project_is_not_renamed_by_its_next_file(client, student, db, naming):
    project_id = create_project(client, student["token"])
    ready(client, student["token"], project_id, NOTES, naming)

    ready(client, student["token"], project_id, NORWEGIAN, naming)

    assert name_of(db, project_id) == (NOTES_NAME, "auto")
    assert naming.model_calls == 1


def test_a_student_name_is_never_replaced_and_the_model_is_not_called(client, student, db, naming):
    project_id = create_project(client, student["token"])
    renamed = client.patch(f"/api/projects/{project_id}", headers=bearer(student["token"]), json={"name": "Biology"})
    assert renamed.status_code == 200, renamed.text

    ready(client, student["token"], project_id, NOTES, naming)
    ready(client, student["token"], project_id, NORWEGIAN, naming)

    assert name_of(db, project_id) == ("Biology", "student")
    assert naming.model_calls == 0


def test_a_rename_while_the_model_answers_wins(client, student, db, naming, monkeypatch):
    project_id = create_project(client, student["token"])
    real_name_project = Gateway.name_project

    async def rename_meanwhile(self, sections):
        db.execute("UPDATE projects SET name = 'Mine', name_source = 'student' WHERE id = %s", (project_id,))
        return await real_name_project(self, sections)

    monkeypatch.setattr(Gateway, "name_project", rename_meanwhile)

    ready(client, student["token"], project_id, NOTES, naming)

    assert naming.attempts[-1] is None
    assert name_of(db, project_id) == ("Mine", "student")


@pytest.mark.parametrize(
    "failure",
    [ProviderUnavailable("down"), LLMOutputError("invalid"), "blank"],
    ids=["provider_unavailable", "output_invalid", "blank_name"],
)
def test_failed_naming_leaves_the_file_ready_the_job_completed_and_the_name_null(
    client, student, db, naming, monkeypatch, failure
):
    async def failing(self, sections):
        if failure == "blank":
            return SimpleNamespace(name="   ")
        raise failure

    monkeypatch.setattr(Gateway, "name_project", failing)
    project_id = create_project(client, student["token"])

    material = ready(client, student["token"], project_id, NOTES, naming)

    assert naming.attempts == [None]
    assert name_of(db, project_id) == (None, None)
    job = db.execute("SELECT status FROM generation_jobs WHERE result_ref = %s", (material["id"],)).fetchone()
    assert job == ("completed",)


def test_naming_is_retried_after_the_next_ready_file(client, student, db, naming, monkeypatch):
    real_name_project = Gateway.name_project
    calls = []

    async def fails_once(self, sections):
        calls.append(1)
        if len(calls) == 1:
            raise ProviderUnavailable("down")
        return await real_name_project(self, sections)

    monkeypatch.setattr(Gateway, "name_project", fails_once)
    project_id = create_project(client, student["token"])

    ready(client, student["token"], project_id, NOTES, naming)
    assert name_of(db, project_id) == (None, None)

    ready(client, student["token"], project_id, NORWEGIAN, naming)

    assert name_of(db, project_id) == (NORWEGIAN_NAME, "auto")
    assert len(calls) == 2


def test_a_rejected_file_makes_no_naming_attempt(client, student, db, naming):
    project_id = create_project(client, student["token"])
    response = upload(client, student["token"], project_id, "integrity-reject.pdf")
    assert response.status_code == 202, response.text
    material_id = response.json()["material"]["id"]

    material = next(m for m in wait_until_done(client, student["token"], project_id) if m["id"] == material_id)
    assert material["status"] == "rejected"
    # The rejected plan's after-commit step (deleting the original) has run by now.
    wait_for(lambda: stored_objects(db, student["id"], project_id, material_id) == 0)

    assert naming.attempts == []
    assert naming.model_calls == 0
    assert name_of(db, project_id) == (None, None)


def test_a_project_archived_while_the_model_answers_stays_unnamed(client, student, db, naming, monkeypatch):
    project_id = create_project(client, student["token"])
    real_name_project = Gateway.name_project

    async def archive_meanwhile(self, sections):
        db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project_id,))
        return await real_name_project(self, sections)

    monkeypatch.setattr(Gateway, "name_project", archive_meanwhile)

    ready(client, student["token"], project_id, NOTES, naming)

    assert naming.attempts == [None]
    assert name_of(db, project_id) == (None, None)


def test_a_project_archived_before_the_file_is_ready_does_not_call_the_model(client, student, db, naming, monkeypatch):
    project_id = create_project(client, student["token"])
    real_extract = materials.extraction.extract

    async def archive_first(data, file_type):
        db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project_id,))
        return await real_extract(data, file_type)

    monkeypatch.setattr(materials.extraction, "extract", archive_first)

    ready(client, student["token"], project_id, NOTES, naming)

    assert naming.attempts == [None]
    assert naming.model_calls == 0
    assert name_of(db, project_id) == (None, None)


def test_naming_runs_outside_the_job_slot(settings, student, db, naming, monkeypatch):
    """With one job slot, a second file is processed while the first file's naming still waits."""
    release = threading.Event()
    real_name_project = Gateway.name_project
    started = []

    async def slow_name_project(self, sections):
        started.append(1)
        while not release.is_set():
            await asyncio.sleep(0.02)
        return await real_name_project(self, sections)

    monkeypatch.setattr(Gateway, "name_project", slow_name_project)
    try:
        with TestClient(create_app(settings.model_copy(update={"jobs_max_concurrent": 1})), backend_options=LOOP) as c:
            first = create_project(c, student["token"])
            assert upload_and_wait(c, student["token"], first, NOTES)["status"] == "ready"
            wait_for(lambda: started == [1])

            second = create_project(c, student["token"])
            response = upload(c, student["token"], second, NORWEGIAN)
            assert response.status_code == 202, response.text
            assert wait_until_done(c, student["token"], second, timeout=10)[0]["status"] == "ready"
            assert naming.attempts == []  # the first naming is still waiting for the model

            release.set()
            wait_for(lambda: len(naming.attempts) == 2)
    finally:
        release.set()

    assert name_of(db, first) == (NOTES_NAME, "auto")
    assert name_of(db, second) == (NORWEGIAN_NAME, "auto")
