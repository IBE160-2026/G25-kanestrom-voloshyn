"""Phone upload (Stories 6.1 + 6.2: FR-21, AD-2, AD-5, AD-6, AD-12, AD-24).

Runs the real link, phone routes, and `material_processing` batch jobs in mock mode against local
Supabase, like test_images.py. Photos are the `test-data/notes-photo*.png` files; mock mode reads
each page's outcome from its file name (AD-4).
"""

import asyncio
import hashlib
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import storage as storage_module
from app.config import Settings
from app.extraction import images
from app.llm import Gateway, ProviderUnavailable
from app.main import _RedactTokens, create_app
from app.services import materials, phone, usage
from tests.test_auth import (  # noqa: F401 -- shared fixtures
    LOOP,
    assert_error,
    bearer,
    client,
    created,
    db,
    gotrue,
    sign_up,
)
from tests.test_images import set_used, used
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    insert_material,
    materials_of,
    student,
    wait_for,
    wait_for_job,
    wait_until_done,
)

TEST_DATA = Path(__file__).resolve().parents[2] / "test-data"
PNG = "image/png"
READABLE = "notes-photo.png"
PARTIAL = "notes-photo-partial.png"
UNREADABLE = "notes-photo-unreadable.png"


@pytest.fixture(scope="module")
def settings() -> Settings:
    """As test_auth's, with the link lifetime pinned, so a developer's .env can't change it."""
    env = Settings()
    if not env.supabase_publishable_key or env.supabase_secret_key is None:
        pytest.fail("Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY from `npx supabase status`")
    return Settings(
        _env_file=None,
        llm_mode="mock",
        supabase_publishable_key=env.supabase_publishable_key,
        supabase_secret_key=env.supabase_secret_key,
        phone_link_ttl_seconds=600,
    )


class HoldNth:
    """Holds the `n`-th call of `owner.name` (1-based) until released; counts every call."""

    def __init__(self, monkeypatch, owner, name: str, n: int) -> None:
        self.release = threading.Event()
        self.reached = threading.Event()
        self.calls = 0
        real = getattr(owner, name)

        async def held(*args, **kwargs):
            self.calls += 1
            if self.calls == n:
                self.reached.set()
                while not self.release.is_set():
                    await asyncio.sleep(0.02)
            return await real(*args, **kwargs)

        monkeypatch.setattr(owner, name, held)


def job_status(db, project_id: str) -> str:
    return db.execute(
        "SELECT status FROM generation_jobs WHERE project_id = %s AND kind = 'material_processing'", (project_id,)
    ).fetchone()[0]


def remove_material(client, token: str, project_id: str, material_id: str) -> None:
    response = client.delete(f"/api/projects/{project_id}/materials/{material_id}", headers=bearer(token))
    assert response.status_code == 204, response.text


# --- Helpers ---


def create_link(client, token: str, project_id: str):
    return client.post(f"/api/projects/{project_id}/phone-links", headers=bearer(token))


def new_link(client, token: str, project_id: str) -> dict:
    response = create_link(client, token, project_id)
    assert response.status_code == 201, response.text
    return response.json()


def phone_get(client, link: dict):
    return client.get(f"/api/phone/{link['token']}")


def new_batch(client, link: dict) -> str:
    response = client.post(f"/api/phone/{link['token']}/batches")
    assert response.status_code == 201, response.text
    return response.json()["batch_id"]


def send_photo(client, link: dict, batch_id: str, name: str, data: bytes | None = None, content_type: str = PNG):
    if data is None:
        data = (TEST_DATA / name).read_bytes()
    return client.post(
        f"/api/phone/{link['token']}/batches/{batch_id}/photos", files={"file": (name, data, content_type)}
    )


def finalize(client, link: dict, batch_id: str):
    return client.post(f"/api/phone/{link['token']}/batches/{batch_id}/finalize")


def send_batch(client, link: dict, names: list[str]) -> str:
    batch_id = new_batch(client, link)
    for name in names:
        assert send_photo(client, link, batch_id, name).status_code == 201
    return batch_id


def staged_photos(db, account_id: str, project_id: str) -> int:
    return db.execute(
        "SELECT count(*) FROM storage.objects WHERE bucket_id = 'study-materials' AND name LIKE %s",
        (f"{account_id}/{project_id}/phone/%",),
    ).fetchone()[0]


def sections_of(db, material_id: str) -> list[tuple[str, str]]:
    return db.execute(
        "SELECT label, text FROM sections WHERE material_id = %s ORDER BY position", (material_id,)
    ).fetchall()


def expire(db, link: dict, seconds_ago: int) -> None:
    db.execute(
        "UPDATE phone_upload_links SET expires_at = now() - make_interval(secs => %s) WHERE id = %s",
        (seconds_ago, link["link_id"]),
    )


def batches_of(db, project_id: str) -> int:
    return db.execute("SELECT count(*) FROM phone_batches WHERE project_id = %s", (project_id,)).fetchone()[0]


def run_cleanup(settings) -> int:
    from app import supabase_auth
    from app.db.pool import create_pool
    from app.storage import Storage

    async def go() -> int:
        pool = create_pool(settings)
        await pool.open()
        http = supabase_auth.create_client(settings)
        try:
            return await phone.cleanup_stale(pool, Storage(http, settings))
        finally:
            await http.aclose()
            await pool.close()

    return asyncio.run(go(), **LOOP)


# --- The link (Story 6.1) ---


def test_create_link_stores_only_the_hash_and_expires_in_ten_minutes(client, student, db):
    project_id = create_project(client, student["token"])

    link = new_link(client, student["token"], project_id)

    assert set(link) == {"link_id", "token", "expires_at"}
    assert len(link["token"]) >= 43
    row = db.execute(
        "SELECT token_hash, extract(epoch FROM expires_at - created_at), revoked_at FROM phone_upload_links WHERE id = %s",
        (link["link_id"],),
    ).fetchone()
    assert row[0] == hashlib.sha256(link["token"].encode()).hexdigest()
    assert abs(float(row[1]) - 600) < 2
    assert row[2] is None
    # The token itself is nowhere in the table.
    assert db.execute(
        "SELECT count(*) FROM phone_upload_links WHERE token_hash = %s", (link["token"],)
    ).fetchone()[0] == 0

def test_the_link_lifetime_defaults_to_600_seconds(monkeypatch):
    monkeypatch.delenv("PHONE_LINK_TTL_SECONDS", raising=False)
    assert Settings(_env_file=None).phone_link_ttl_seconds == 600


def test_create_link_needs_the_privacy_notice(client, gotrue, created):
    body = sign_up(gotrue, created)
    project_id = create_project(client, body["access_token"])

    assert_error(create_link(client, body["access_token"], project_id), 403, "privacy_notice_required")


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_create_link_in_a_read_only_project_is_refused(client, student, db, column):
    project_id = create_project(client, student["token"])
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project_id,))

    assert_error(create_link(client, student["token"], project_id), 409, "project_read_only")


def test_create_link_needs_a_session_and_an_own_project(client, gotrue, created, student):
    project_id = create_project(client, student["token"])
    assert_error(client.post(f"/api/projects/{project_id}/phone-links"), 401, "unauthorized")
    other = sign_up(gotrue, created)
    client.post("/api/me/privacy-notice", headers=bearer(other["access_token"]))
    assert_error(create_link(client, other["access_token"], project_id), 404, "not_found")


def test_config_tells_the_spa_the_public_url(client, settings):
    assert client.get("/api/config").json()["app_public_url"] == settings.app_public_url.rstrip("/")


# --- phone_link_auth and the phone GET ---


def test_phone_get_returns_only_the_four_fields(client, student, db):
    project_id = create_project(client, student["token"])
    client.patch(f"/api/projects/{project_id}", headers=bearer(student["token"]), json={"name": "Biology"})
    insert_material(db, student["id"], project_id, "ready")
    set_used(db, student["id"], 20)
    link = new_link(client, student["token"], project_id)

    response = phone_get(client, link)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"project_name", "images_left_today", "slot_available", "expires_at"}
    assert (body["project_name"], body["images_left_today"], body["slot_available"]) == ("Biology", 5, True)


def test_phone_get_says_when_the_project_is_full(client, student, db):
    project_id = create_project(client, student["token"])
    for _ in range(10):
        insert_material(db, student["id"], project_id, "ready")
    link = new_link(client, student["token"], project_id)

    assert phone_get(client, link).json()["slot_available"] is False


@pytest.mark.parametrize("token", ["unknown-token-unknown-token-unknown-token-xx", "short", "x" * 300])
def test_unknown_token_is_link_expired(client, token):
    assert_error(client.get(f"/api/phone/{token}"), 410, "link_expired")


def test_expired_link_is_link_expired_for_everything_but_finalize(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = new_batch(client, link)
    expire(db, link, 1)

    assert_error(phone_get(client, link), 410, "link_expired")
    assert_error(client.post(f"/api/phone/{link['token']}/batches"), 410, "link_expired")
    assert_error(send_photo(client, link, batch_id, READABLE), 410, "link_expired")
    assert used(db, student["id"]) == 0


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_a_link_stops_when_its_project_is_no_longer_active(client, student, db, column):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project_id,))

    assert_error(phone_get(client, link), 410, "link_expired")


def test_a_user_token_is_not_a_phone_link(client, student):
    assert_error(client.get(f"/api/phone/{student['token']}"), 410, "link_expired")


# --- Revoke ---


def test_closing_the_dialog_revokes_the_link_and_uploads_are_refused(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = new_batch(client, link)

    response = client.delete(f"/api/projects/{project_id}/phone-links/{link['link_id']}", headers=bearer(student["token"]))

    assert response.status_code == 204
    assert_error(phone_get(client, link), 410, "link_expired")
    assert_error(send_photo(client, link, batch_id, READABLE), 410, "link_expired")
    assert_error(finalize(client, link, batch_id), 410, "link_expired")
    assert staged_photos(db, student["id"], project_id) == 0
    assert used(db, student["id"]) == 0
    # Again: still 204 (bookkeeping, idempotent).
    again = client.delete(f"/api/projects/{project_id}/phone-links/{link['link_id']}", headers=bearer(student["token"]))
    assert again.status_code == 204


def test_the_beacon_revokes_the_link(client, student):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)

    assert client.post(f"/api/phone/{link['token']}/revoke").status_code == 204
    assert_error(phone_get(client, link), 410, "link_expired")


def test_revoke_is_scoped_to_the_account_and_project(client, gotrue, created, student):
    project_id = create_project(client, student["token"])
    other_project = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    other = sign_up(gotrue, created)

    foreign = client.delete(f"/api/projects/{project_id}/phone-links/{link['link_id']}", headers=bearer(other["access_token"]))
    wrong = client.delete(f"/api/projects/{other_project}/phone-links/{link['link_id']}", headers=bearer(student["token"]))

    assert_error(foreign, 404, "not_found")
    assert_error(wrong, 404, "not_found")
    assert phone_get(client, link).status_code == 200


def test_a_read_only_project_can_still_revoke(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project_id,))

    response = client.delete(f"/api/projects/{project_id}/phone-links/{link['link_id']}", headers=bearer(student["token"]))

    assert response.status_code == 204


# --- Sending a batch (Story 6.2) ---


def test_three_photos_become_one_material_ready_partly_unreadable(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, PARTIAL, READABLE])
    assert used(db, student["id"]) == 3

    response = finalize(client, link, batch_id)

    assert response.status_code == 202, response.text
    assert response.json() == {"pages": 3}
    [material] = wait_until_done(client, student["token"], project_id)
    assert material["file_name"] == "Handwritten notes, 3 pages"
    assert material["file_type"] == "phone_batch"
    assert (material["status"], material["warning"], material["warning_pages"]) == ("ready", True, [2])
    assert [label for label, _ in sections_of(db, material["id"])] == ["Page 1", "Page 2", "Page 3"]
    assert len(material["topics"]) >= 3
    assert used(db, student["id"]) == 3
    # The staged photos are gone once the batch is processed (AD-5: no feature reads originals).
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)
    assert phone_get(client, link).json()["images_left_today"] == 22


def test_an_unreadable_photo_becomes_an_empty_page(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, UNREADABLE])

    assert finalize(client, link, batch_id).status_code == 202
    [material] = wait_until_done(client, student["token"], project_id)

    assert (material["status"], material["warning_pages"]) == ("ready", [2])
    assert material["file_name"] == "Handwritten notes, 2 pages"
    pages = sections_of(db, material["id"])
    assert pages[0][1].strip() and pages[1] == ("Page 2", "")
    assert used(db, student["id"]) == 2


def test_every_photo_readable_is_ready_without_a_warning(client, student):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE])

    assert finalize(client, link, batch_id).status_code == 202
    [material] = wait_until_done(client, student["token"], project_id)

    assert (material["status"], material["warning"], material["file_name"]) == ("ready", False, "Handwritten notes, 1 page")


def test_all_unreadable_is_rejected_and_takes_no_slot(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [UNREADABLE, UNREADABLE])

    assert finalize(client, link, batch_id).status_code == 202
    [material] = wait_until_done(client, student["token"], project_id)

    assert (material["status"], material["reject_reason"]) == ("rejected", "unreadable")
    assert phone_get(client, link).json()["slot_available"] is True
    # Both vision calls ran: the units stay used.
    assert used(db, student["id"]) == 2
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)


def test_the_name_follows_the_accounts_language(client, student, db):
    db.execute("UPDATE profiles SET language = 'nb' WHERE account_id = %s", (student["id"],))
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)

    finalize(client, link, send_batch(client, link, [READABLE, READABLE]))
    finalize(client, link, send_batch(client, link, [READABLE]))
    names = sorted(m["file_name"] for m in wait_until_done(client, student["token"], project_id))

    assert names == ["Håndskrevne notater, 1 side", "Håndskrevne notater, 2 sider"]


def test_send_more_makes_a_second_material(client, student):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)

    assert finalize(client, link, send_batch(client, link, [READABLE])).status_code == 202
    assert finalize(client, link, send_batch(client, link, [READABLE])).status_code == 202

    assert len(wait_until_done(client, student["token"], project_id)) == 2


def test_over_the_daily_limit_the_extra_photo_is_refused_alone(client, student, db):
    project_id = create_project(client, student["token"])
    set_used(db, student["id"], 23)
    link = new_link(client, student["token"], project_id)
    batch_id = new_batch(client, link)

    statuses = [send_photo(client, link, batch_id, READABLE) for _ in range(3)]

    assert [r.status_code for r in statuses[:2]] == [201, 201]
    assert_error(statuses[2], 429, "quota_exceeded")
    assert staged_photos(db, student["id"], project_id) == 2
    assert finalize(client, link, batch_id).json() == {"pages": 2}
    [material] = wait_until_done(client, student["token"], project_id)
    assert material["file_name"] == "Handwritten notes, 2 pages"
    assert used(db, student["id"]) == 25


def test_a_photo_over_50_mb_is_refused_alone(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = new_batch(client, link)

    big = send_photo(client, link, batch_id, "big-photo.png", b"\0" * (materials.MAX_BYTES + 1024 * 1024))
    ok = send_photo(client, link, batch_id, READABLE)

    assert_error(big, 413, "file_too_large")
    assert ok.status_code == 201 and ok.json() == {"page": 1}
    assert used(db, student["id"]) == 1
    assert finalize(client, link, batch_id).json() == {"pages": 1}


@pytest.mark.parametrize("name", ["notes.pdf", "notes.gif", "notes"])
def test_a_photo_of_another_type_is_refused_alone(client, student, db, name):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = new_batch(client, link)

    assert_error(send_photo(client, link, batch_id, name, b"data"), 422, "unsupported_file_type")
    assert used(db, student["id"]) == 0
    assert staged_photos(db, student["id"], project_id) == 0


def test_project_full_refuses_finalize_deletes_photos_and_releases_units(client, student, db):
    project_id = create_project(client, student["token"])
    for _ in range(10):
        insert_material(db, student["id"], project_id, "ready")
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, READABLE])
    assert used(db, student["id"]) == 2

    response = finalize(client, link, batch_id)

    assert_error(response, 409, "material_limit_reached")
    assert used(db, student["id"]) == 0
    assert batches_of(db, project_id) == 0
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)
    assert len(materials_of(client, student["token"], project_id)) == 10


def test_finalize_with_no_photo_creates_nothing(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = new_batch(client, link)

    assert_error(finalize(client, link, batch_id), 422, "insufficient_material")
    assert materials_of(client, student["token"], project_id) == []


def test_a_finalized_batch_takes_no_more_photos_and_no_second_finalize(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE])
    assert finalize(client, link, batch_id).status_code == 202

    assert_error(send_photo(client, link, batch_id, READABLE), 409, "conflict")
    assert_error(finalize(client, link, batch_id), 409, "conflict")
    wait_until_done(client, student["token"], project_id)
    assert used(db, student["id"]) == 1


def test_the_link_cannot_act_outside_its_batch(client, student, gotrue, created, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    other_link = new_link(client, student["token"], project_id)
    other_batch = new_batch(client, other_link)

    assert_error(send_photo(client, link, other_batch, READABLE), 404, "not_found")
    assert_error(finalize(client, link, other_batch), 404, "not_found")
    assert_error(send_photo(client, link, "00000000-0000-0000-0000-000000000000", READABLE), 404, "not_found")
    assert used(db, student["id"]) == 0


def test_finalize_is_allowed_for_ten_minutes_after_expiry(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE])
    expire(db, link, 9 * 60)

    assert finalize(client, link, batch_id).status_code == 202
    wait_until_done(client, student["token"], project_id)


def test_finalize_after_the_grace_is_link_expired(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE])
    expire(db, link, 11 * 60)

    assert_error(finalize(client, link, batch_id), 410, "link_expired")
    assert materials_of(client, student["token"], project_id) == []


# --- Release paths and cleanup ---


def test_never_finalized_batch_is_cleaned_up(settings, client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    send_batch(client, link, [READABLE, PARTIAL])
    fresh_link = new_link(client, student["token"], project_id)
    send_batch(client, fresh_link, [READABLE])
    assert used(db, student["id"]) == 3
    expire(db, link, 11 * 60)

    assert run_cleanup(settings) >= 1

    assert used(db, student["id"]) == 1
    assert batches_of(db, project_id) == 1
    assert staged_photos(db, student["id"], project_id) == 1
    assert materials_of(client, student["token"], project_id) == []


def test_a_batch_inside_its_grace_is_not_cleaned_up(settings, client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    send_batch(client, link, [READABLE])
    expire(db, link, 9 * 60)

    run_cleanup(settings)

    assert batches_of(db, project_id) == 1
    assert used(db, student["id"]) == 1


def test_provider_error_releases_that_photo_and_the_rest(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, PARTIAL, READABLE])
    real = Gateway.extract_image_text
    calls = []

    async def second_fails(self, jpeg, file_name):
        calls.append(file_name)
        if len(calls) == 2:
            raise ProviderUnavailable("Provider answered 503")
        return await real(self, jpeg, file_name)

    monkeypatch.setattr(Gateway, "extract_image_text", second_fails)

    assert finalize(client, link, batch_id).status_code == 202
    [material] = wait_until_done(client, student["token"], project_id)

    assert (material["status"], material["reject_reason"]) == ("rejected", "processing_failed")
    # Page 1's call ran; page 2's failed at the provider; page 3's never started.
    assert len(calls) == 2
    wait_for(lambda: used(db, student["id"]) == 1)
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)


def test_an_undecodable_photo_is_an_empty_page_and_its_unit_comes_back(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = new_batch(client, link)
    assert send_photo(client, link, batch_id, READABLE).status_code == 201
    assert send_photo(client, link, batch_id, "broken.png", b"not really a photo").status_code == 201

    assert finalize(client, link, batch_id).status_code == 202
    [material] = wait_until_done(client, student["token"], project_id)

    assert (material["status"], material["warning_pages"]) == ("ready", [2])
    assert used(db, student["id"]) == 1


def test_removing_a_queued_batch_releases_every_unit(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, READABLE])
    # Keep the job queued: the runner is not handed it.
    monkeypatch.setattr(type(client.app.state.runner), "submit", lambda self, job, payload=None: None)
    assert finalize(client, link, batch_id).status_code == 202
    [material] = materials_of(client, student["token"], project_id)

    response = client.delete(f"/api/projects/{project_id}/materials/{material['id']}", headers=bearer(student["token"]))

    assert response.status_code == 204
    assert used(db, student["id"]) == 0
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)


def test_restart_sweep_releases_units_of_a_batch_never_read(settings, client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, READABLE])
    monkeypatch.setattr(type(client.app.state.runner), "submit", lambda self, job, payload=None: None)
    assert finalize(client, link, batch_id).status_code == 202
    job_id = db.execute(
        "SELECT id FROM generation_jobs WHERE project_id = %s AND kind = 'material_processing'", (project_id,)
    ).fetchone()[0]
    db.execute("UPDATE generation_jobs SET created_at = now() - interval '1 hour' WHERE id = %s", (job_id,))

    with TestClient(create_app(settings), backend_options=LOOP):
        assert wait_for_job(db, str(job_id)) == "failed"

    [material] = materials_of(client, student["token"], project_id)
    assert (material["status"], material["reject_reason"]) == ("rejected", "interrupted")
    wait_for(lambda: used(db, student["id"]) == 0)
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)


# --- Logs and the browser keys ---


def test_access_log_redacts_the_phone_token():
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1", "POST", "/api/phone/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde/batches", "1.1", 201),
        None,
    )
    _RedactTokens().filter(record)
    assert "AbCdEf" not in record.getMessage()
    assert "/api/phone/[redacted]/batches" in record.getMessage()

    page = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, "GET /u/secret-token-value-123456 200", None, None)
    _RedactTokens().filter(page)
    assert page.getMessage() == "GET /u/[redacted] 200"


def test_phone_tables_are_closed_to_the_browser_keys(db):
    for table in ("phone_upload_links", "phone_batches", "phone_batch_photos"):
        row = db.execute(
            f"SELECT has_table_privilege('anon', 'public.{table}', 'SELECT'),"
            f" has_table_privilege('authenticated', 'public.{table}', 'SELECT')"
        ).fetchone()
        assert row == (False, False), table


def test_judge_batch_rows():
    from app.extraction import integrity

    t = integrity.Thresholds()
    readable = ("readable", "x" * 60)
    partial = ("partial", "x" * 60)
    unreadable = ("unreadable", "")
    short = ("readable", "x" * 10)

    assert integrity.judge_batch([readable, readable], t) == integrity.ACCEPTED
    assert integrity.judge_batch([readable, partial, short], t) == integrity.Verdict(
        "accepted_with_warning", warning_pages=(2, 3)
    )
    assert integrity.judge_batch([unreadable, short], t) == integrity.UNREADABLE
    assert integrity.judge_batch([], t) == integrity.UNREADABLE
    assert usage.LIMITS[usage.IMAGE_EXTRACTION] == 25


# --- Review fixes ---


@pytest.mark.parametrize("how", ["delete", "beacon"])
def test_revoking_discards_open_batches_with_their_photos_and_units(client, student, db, how):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    send_batch(client, link, [READABLE, PARTIAL])
    assert (used(db, student["id"]), staged_photos(db, student["id"], project_id)) == (2, 2)

    if how == "delete":
        url = f"/api/projects/{project_id}/phone-links/{link['link_id']}"
        response = client.delete(url, headers=bearer(student["token"]))
    else:
        response = client.post(f"/api/phone/{link['token']}/revoke")

    assert response.status_code == 204
    assert used(db, student["id"]) == 0
    assert batches_of(db, project_id) == 0
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)
    assert materials_of(client, student["token"], project_id) == []


def test_revoking_keeps_a_finalized_batch(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    assert finalize(client, link, send_batch(client, link, [READABLE])).status_code == 202

    client.delete(f"/api/projects/{project_id}/phone-links/{link['link_id']}", headers=bearer(student["token"]))

    [material] = wait_until_done(client, student["token"], project_id)
    assert material["status"] == "ready"
    assert used(db, student["id"]) == 1


def test_finalize_of_a_batch_cleaned_up_after_expiry_is_link_expired(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE])
    expire(db, link, 5 * 60)
    db.execute("DELETE FROM phone_batches WHERE id = %s", (batch_id,))

    assert_error(finalize(client, link, batch_id), 410, "link_expired")


def test_cleanup_takes_batches_of_a_revoked_link(settings, client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    send_batch(client, link, [READABLE])
    db.execute("UPDATE phone_upload_links SET revoked_at = now() WHERE id = %s", (link["link_id"],))

    run_cleanup(settings)

    assert batches_of(db, project_id) == 0
    assert used(db, student["id"]) == 0
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)


def test_cleanup_deletes_links_expired_over_a_day_ago_with_their_rows(settings, client, student, db):
    project_id = create_project(client, student["token"])
    old = new_link(client, student["token"], project_id)
    assert finalize(client, old, send_batch(client, old, [READABLE])).status_code == 202
    wait_until_done(client, student["token"], project_id)
    recent = new_link(client, student["token"], project_id)
    expire(db, old, 2 * 86_400)
    expire(db, recent, 3600)

    run_cleanup(settings)

    links = {row[0] for row in db.execute("SELECT id::text FROM phone_upload_links WHERE project_id = %s", (project_id,))}
    assert links == {recent["link_id"]}
    assert batches_of(db, project_id) == 0
    assert len(materials_of(client, student["token"], project_id)) == 1


def test_the_app_starts_the_cleanup_at_startup(settings, client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    send_batch(client, link, [READABLE])
    expire(db, link, 11 * 60)

    with TestClient(create_app(settings), backend_options=LOOP):
        wait_for(lambda: batches_of(db, project_id) == 0)

    assert used(db, student["id"]) == 0


def test_a_storage_failure_releases_the_photos_unit(settings, student, db, monkeypatch):
    async def broken_put(self, path, data, content_type):
        raise storage_module.StorageError("HTTP 500")

    with TestClient(create_app(settings), backend_options=LOOP, raise_server_exceptions=False) as c:
        project_id = create_project(c, student["token"])
        link = new_link(c, student["token"], project_id)
        batch_id = new_batch(c, link)
        monkeypatch.setattr(storage_module.Storage, "put", broken_put)

        assert_error(send_photo(c, link, batch_id, READABLE), 500, "internal_error")

    assert used(db, student["id"]) == 0
    assert db.execute("SELECT count(*) FROM phone_batch_photos WHERE batch_id = %s", (batch_id,)).fetchone()[0] == 0


def test_concurrent_finalize_of_one_batch_makes_one_material(client, student, db):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE])
    barrier = threading.Barrier(2)

    def one() -> int:
        barrier.wait()
        return finalize(client, link, batch_id).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda _: one(), range(2)))

    assert statuses == [202, 409]
    assert len(wait_until_done(client, student["token"], project_id)) == 1
    assert used(db, student["id"]) == 1


def test_removing_a_batch_mid_read_stops_after_the_running_call(client, student, db, monkeypatch):
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, READABLE, READABLE])
    vision = HoldNth(monkeypatch, Gateway, "extract_image_text", 2)
    assert finalize(client, link, batch_id).status_code == 202
    assert vision.reached.wait(15)
    [material] = materials_of(client, student["token"], project_id)

    remove_material(client, student["token"], project_id, material["id"])
    vision.release.set()

    wait_for(lambda: job_status(db, project_id) == "cancelled")
    assert vision.calls == 2
    wait_for(lambda: used(db, student["id"]) == 2)
    wait_for(lambda: staged_photos(db, student["id"], project_id) == 0)


def test_a_removal_before_a_photos_call_starts_gives_its_unit_back(client, student, db, monkeypatch):
    # The removal lands after photo 2 was read from storage but before its vision call: the call never
    # starts, and photos 2 and 3 get their units back.
    project_id = create_project(client, student["token"])
    link = new_link(client, student["token"], project_id)
    batch_id = send_batch(client, link, [READABLE, READABLE, READABLE])
    calls = []
    real_vision = Gateway.extract_image_text

    async def counted(self, jpeg, file_name):
        calls.append(file_name)
        return await real_vision(self, jpeg, file_name)

    monkeypatch.setattr(Gateway, "extract_image_text", counted)
    normalize = HoldNth(monkeypatch, images, "normalize", 2)
    assert finalize(client, link, batch_id).status_code == 202
    assert normalize.reached.wait(15)
    [material] = materials_of(client, student["token"], project_id)

    remove_material(client, student["token"], project_id, material["id"])
    normalize.release.set()

    wait_for(lambda: job_status(db, project_id) == "cancelled")
    assert len(calls) == 1
    wait_for(lambda: used(db, student["id"]) == 1)


def test_the_phone_page_is_served_with_no_referrer(client):
    response = client.get("/u/some-token-value-1234567890", headers={"accept": "text/html"})
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "referrer-policy" not in {k.lower() for k in client.get("/api/config").headers}
