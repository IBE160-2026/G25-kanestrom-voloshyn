"""Photos of notes and the daily image limit (Story 2.5, FR-7, AD-4, AD-6, AD-12).

Runs real uploads and `material_processing` jobs in mock mode against local Supabase, like
test_materials.py. The three `test-data/notes-photo*.png` give the three mock outcomes; a tiny HEIC is
made here with pillow-heif (none is committed).
"""

import asyncio
import io
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import storage as storage_module
from app.config import ConfigError, Settings
from app.extraction import Extracted, ExtractedSection, Unparseable, images, integrity
from app.llm import Gateway, ImageText, ProviderUnavailable, create_gateway
from app.llm import fixtures
from app.main import create_app
from app.services import materials, usage
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
    materials_of,
    objects_in_project,
    stored_objects,
    student,
    upload,
    upload_and_wait,
    wait_for,
    wait_for_job,
    wait_until_done,
)

TEST_DATA = Path(__file__).resolve().parents[2] / "test-data"
PNG = "image/png"
KIND = usage.IMAGE_EXTRACTION


# --- Helpers ---


def today() -> date:
    return usage.usage_day()


def used(db, account_id: str, day: date | None = None) -> int:
    row = db.execute(
        "SELECT count FROM usage_counters WHERE account_id = %s AND usage_day = %s AND kind = %s",
        (account_id, day or today(), KIND),
    ).fetchone()
    return row[0] if row else 0


def set_used(db, account_id: str, count: int, day: date | None = None) -> None:
    db.execute(
        """
        INSERT INTO usage_counters (account_id, usage_day, kind, count) VALUES (%s, %s, %s, %s)
        ON CONFLICT (account_id, usage_day, kind) DO UPDATE SET count = excluded.count
        """,
        (account_id, day or today(), KIND, count),
    )


def upload_image(client, token: str, project_id: str, name: str, data: bytes | None = None):
    return upload(client, token, project_id, name, data=data, content_type=PNG)


def image_and_wait(client, token: str, project_id: str, name: str, data: bytes | None = None) -> dict:
    response = upload_image(client, token, project_id, name, data)
    assert response.status_code == 202, response.text
    material_id = response.json()["material"]["id"]
    return next(m for m in wait_until_done(client, token, project_id) if m["id"] == material_id)


def images_left(client, token: str) -> int:
    response = client.get("/api/usage", headers=bearer(token))
    assert response.status_code == 200, response.text
    return response.json()["images_left_today"]


def heic_bytes(size: tuple[int, int] = (64, 48)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, "white").save(out, format="HEIF")
    return out.getvalue()


def sections_of(db, material_id: str) -> list[tuple[str, str]]:
    return db.execute(
        "SELECT label, text FROM sections WHERE material_id = %s ORDER BY position", (material_id,)
    ).fetchall()


def job_row(db, job_id: str):
    return db.execute(
        "SELECT status, error_code, vision_started_at IS NOT NULL FROM generation_jobs WHERE id = %s", (job_id,)
    ).fetchone()


class Held:
    """Holds every call of `owner.name` until released, and counts the calls that started."""

    def __init__(self, monkeypatch, owner, name: str) -> None:
        self.release = threading.Event()
        self.started = 0
        real = getattr(owner, name)

        async def held(*args, **kwargs):
            self.started += 1
            while not self.release.is_set():
                await asyncio.sleep(0.02)
            return await real(*args, **kwargs)

        monkeypatch.setattr(owner, name, held)


# --- Mock outcomes (matrix rows) ---


def test_readable_photo_is_ready_with_one_image_section_and_topics(client, student, db):
    project_id = create_project(client, student["token"])

    material = image_and_wait(client, student["token"], project_id, "notes-photo.png")

    assert (material["status"], material["warning"], material["file_type"]) == ("ready", False, "png")
    sections = sections_of(db, material["id"])
    assert [label for label, _ in sections] == ["Image"]
    assert len(sections[0][1].strip()) >= 50
    assert len(material["topics"]) >= 3
    assert used(db, student["id"]) == 1
    assert images_left(client, student["token"]) == 24
    # Handled like any file afterwards: the Topics edit as usual (FR-7, FR-22).
    topic = material["topics"][0]
    renamed = client.patch(
        f"/api/projects/{project_id}/topics/{topic['id']}", headers=bearer(student["token"]), json={"label": "Light"}
    )
    assert renamed.status_code == 200, renamed.text


def test_partial_photo_is_ready_partly_unreadable(client, student, db):
    project_id = create_project(client, student["token"])

    material = image_and_wait(client, student["token"], project_id, "notes-photo-partial.png")

    assert (material["status"], material["warning"]) == ("ready", True)
    assert used(db, student["id"]) == 1


def test_unreadable_photo_is_rejected_and_its_unit_stays_used(client, student, db):
    project_id = create_project(client, student["token"])

    material = image_and_wait(client, student["token"], project_id, "notes-photo-unreadable.png")

    assert (material["status"], material["reject_reason"]) == ("rejected", "unreadable")
    assert sections_of(db, material["id"]) == []
    assert used(db, student["id"]) == 1
    wait_for(lambda: stored_objects(db, student["id"], project_id, material["id"]) == 0)


def test_all_three_test_photos_end_ready_partly_unreadable_and_rejected(client, student):
    project_id = create_project(client, student["token"])
    for name in ("notes-photo.png", "notes-photo-partial.png", "notes-photo-unreadable.png"):
        assert upload_image(client, student["token"], project_id, name).status_code == 202
    listed = {m["file_name"]: m for m in wait_until_done(client, student["token"], project_id)}

    assert (listed["notes-photo.png"]["status"], listed["notes-photo.png"]["warning"]) == ("ready", False)
    assert (listed["notes-photo-partial.png"]["status"], listed["notes-photo-partial.png"]["warning"]) == ("ready", True)
    assert listed["notes-photo-unreadable.png"]["status"] == "rejected"
    assert images_left(client, student["token"]) == 22


@pytest.mark.parametrize("name", ["notes.jpg", "notes.JPEG"])
def test_jpeg_names_are_accepted_as_jpg(client, student, name):
    project_id = create_project(client, student["token"])
    jpeg = io.BytesIO()
    Image.open(TEST_DATA / "notes-photo.png").convert("RGB").save(jpeg, format="JPEG")

    material = image_and_wait(client, student["token"], project_id, name, jpeg.getvalue())

    assert (material["status"], material["file_type"]) == ("ready", "jpg")


def test_heic_photo_is_normalized_then_ready(client, student, db):
    project_id = create_project(client, student["token"])

    material = image_and_wait(client, student["token"], project_id, "whiteboard.heic", heic_bytes())

    assert (material["status"], material["file_type"]) == ("ready", "heic")
    assert used(db, student["id"]) == 1


def test_undecodable_heic_is_rejected_unparseable_and_its_unit_released(client, student, db):
    project_id = create_project(client, student["token"])

    material = image_and_wait(client, student["token"], project_id, "broken.heic", b"not really a photo")

    assert (material["status"], material["reject_reason"]) == ("rejected", "unparseable")
    assert used(db, student["id"]) == 0
    wait_for(lambda: stored_objects(db, student["id"], project_id, material["id"]) == 0)


def test_png_bytes_named_jpg_are_rejected_unparseable_and_the_unit_released(client, student, db):
    project_id = create_project(client, student["token"])
    png = (TEST_DATA / "notes-photo.png").read_bytes()

    material = image_and_wait(client, student["token"], project_id, "notes-photo.jpg", png)

    assert (material["status"], material["reject_reason"]) == ("rejected", "unparseable")
    assert used(db, student["id"]) == 0


# --- The daily limit ---


def test_the_26th_image_today_is_refused_with_nothing_stored(client, student, db):
    project_id = create_project(client, student["token"])
    set_used(db, student["id"], 25)
    assert images_left(client, student["token"]) == 0

    response = upload_image(client, student["token"], project_id, "notes-photo.png")

    assert_error(response, 429, "quota_exceeded")
    assert response.json()["error"]["params"] == {"limit": 25, "kind": "image_extraction"}
    assert materials_of(client, student["token"], project_id) == []
    assert db.execute("SELECT count(*) FROM generation_jobs WHERE project_id = %s", (project_id,)).fetchone()[0] == 0
    assert objects_in_project(db, student["id"], project_id) == 0
    assert used(db, student["id"]) == 25


def test_documents_are_not_metered(client, student, db):
    project_id = create_project(client, student["token"])
    set_used(db, student["id"], 25)

    response = upload(client, student["token"], project_id, "integrity-warn.txt")

    assert response.status_code == 202, response.text
    wait_until_done(client, student["token"], project_id)
    assert used(db, student["id"]) == 25


def test_parallel_uploads_at_the_last_unit_give_exactly_one_202(client, student, db):
    project_id = create_project(client, student["token"])
    set_used(db, student["id"], 24)
    barrier = threading.Barrier(2)

    def one() -> int:
        barrier.wait()
        return upload_image(client, student["token"], project_id, "notes-photo.png").status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda _: one(), range(2)))

    assert statuses == [202, 429]
    wait_until_done(client, student["token"], project_id)
    assert used(db, student["id"]) == 25
    assert len(materials_of(client, student["token"], project_id)) == 1


def test_yesterdays_images_do_not_count_today(client, student, db):
    project_id = create_project(client, student["token"])
    set_used(db, student["id"], 25, today() - timedelta(days=1))

    assert images_left(client, student["token"]) == 25
    assert upload_image(client, student["token"], project_id, "notes-photo.png").status_code == 202
    wait_until_done(client, student["token"], project_id)
    assert used(db, student["id"]) == 1


def test_the_day_is_the_calendar_day_in_oslo():
    # Winter: Oslo is UTC+1, so 22:59 UTC is still that day there and 23:00 UTC is already the next.
    assert usage.usage_day(datetime(2026, 11, 18, 22, 59, tzinfo=UTC), "Europe/Oslo") == date(2026, 11, 18)
    assert usage.usage_day(datetime(2026, 11, 18, 23, 0, tzinfo=UTC), "Europe/Oslo") == date(2026, 11, 19)
    # Summer: UTC+2.
    assert usage.usage_day(datetime(2026, 6, 30, 21, 59, tzinfo=UTC), "Europe/Oslo") == date(2026, 6, 30)
    assert usage.usage_day(datetime(2026, 6, 30, 22, 0, tzinfo=UTC), "Europe/Oslo") == date(2026, 7, 1)
    assert Settings(_env_file=None).quota_timezone == "Europe/Oslo"


def test_usage_needs_a_session(client):
    assert_error(client.get("/api/usage"), 401, "unauthorized")


def test_release_never_goes_below_zero(settings, student, db):
    from psycopg import AsyncConnection

    async def go() -> None:
        async with await AsyncConnection.connect(settings.database_url.get_secret_value(), autocommit=True) as conn:
            await usage.release(conn, student["id"], KIND, today())
            assert await usage.remaining(conn, student["id"], KIND) == 25
            assert await usage.reserve(conn, student["id"], KIND) == today()
            await usage.release(conn, student["id"], KIND, today())
            await usage.release(conn, student["id"], KIND, today())

    asyncio.run(go(), **LOOP)
    assert used(db, student["id"]) == 0


def test_usage_counters_are_closed_to_the_browser_keys(db):
    row = db.execute(
        "SELECT has_table_privilege('anon', 'public.usage_counters', 'SELECT'),"
        " has_table_privilege('authenticated', 'public.usage_counters', 'SELECT')"
    ).fetchone()
    assert row == (False, False)


# --- Release paths ---


def test_an_eleventh_file_refusal_releases_the_unit(client, student, db):
    project_id = create_project(client, student["token"])
    for _ in range(10):
        insert_material(db, student["id"], project_id, "ready")

    assert_error(upload_image(client, student["token"], project_id, "notes-photo.png"), 409, "material_limit_reached")

    assert used(db, student["id"]) == 0
    assert objects_in_project(db, student["id"], project_id) == 0


def test_a_storage_failure_releases_the_unit(settings, student, db, monkeypatch):
    async def broken_put(self, path, data, content_type):
        raise RuntimeError("storage down")

    monkeypatch.setattr(storage_module.Storage, "put", broken_put)
    with TestClient(create_app(settings), backend_options=LOOP, raise_server_exceptions=False) as c:
        project_id = create_project(c, student["token"])

        assert_error(upload_image(c, student["token"], project_id, "notes-photo.png"), 500, "internal_error")

        assert used(db, student["id"]) == 0
        assert materials_of(c, student["token"], project_id) == []


def test_a_provider_error_fails_the_job_and_releases_the_unit(client, student, db, monkeypatch):
    async def unavailable(self, jpeg, file_name):
        raise ProviderUnavailable("Provider answered 503")

    monkeypatch.setattr(Gateway, "extract_image_text", unavailable)
    project_id = create_project(client, student["token"])

    response = upload_image(client, student["token"], project_id, "notes-photo.png")
    assert response.status_code == 202, response.text
    assert wait_for_job(db, response.json()["job_id"]) == "failed"

    material = materials_of(client, student["token"], project_id)[0]
    assert (material["status"], material["reject_reason"]) == ("rejected", "processing_failed")
    assert used(db, student["id"]) == 0


def test_invalid_output_after_the_call_keeps_the_unit_used(client, student, db, monkeypatch):
    from app.llm import LLMOutputError

    async def invalid(self, jpeg, file_name):
        raise LLMOutputError("bad reply")

    monkeypatch.setattr(Gateway, "extract_image_text", invalid)
    project_id = create_project(client, student["token"])

    response = upload_image(client, student["token"], project_id, "notes-photo.png")
    assert wait_for_job(db, response.json()["job_id"]) == "failed"

    assert used(db, student["id"]) == 1
    assert job_row(db, response.json()["job_id"])[2] is True


def test_removing_a_queued_image_releases_its_unit(settings, student, db, monkeypatch):
    held = Held(monkeypatch, materials.extraction, "extract")
    try:
        with TestClient(
            create_app(settings.model_copy(update={"jobs_max_concurrent": 1})), backend_options=LOOP
        ) as c:
            project_id = create_project(c, student["token"])
            first = upload(c, student["token"], project_id, "integrity-warn.txt").json()
            wait_for(lambda: held.started == 1)
            second = upload_image(c, student["token"], project_id, "notes-photo.png").json()
            assert job_row(db, second["job_id"])[0] == "queued"
            assert used(db, student["id"]) == 1

            response = c.delete(
                f"/api/projects/{project_id}/materials/{second['material']['id']}", headers=bearer(student["token"])
            )
            assert response.status_code == 204, response.text
            assert job_row(db, second["job_id"])[0] == "cancelled"
            assert used(db, student["id"]) == 0

            held.release.set()
            assert wait_for_job(db, first["job_id"]) == "completed"
    finally:
        held.release.set()


def test_removing_an_image_before_its_vision_call_releases_the_unit(settings, student, db, monkeypatch):
    held = Held(monkeypatch, materials.images, "normalize")
    try:
        with TestClient(create_app(settings), backend_options=LOOP) as c:
            project_id = create_project(c, student["token"])
            body = upload_image(c, student["token"], project_id, "notes-photo.png").json()
            wait_for(lambda: held.started == 1)

            response = c.delete(
                f"/api/projects/{project_id}/materials/{body['material']['id']}", headers=bearer(student["token"])
            )
            assert response.status_code == 204, response.text
            assert used(db, student["id"]) == 1  # still running: its save step decides

            held.release.set()
            assert wait_for_job(db, body["job_id"]) == "cancelled"
    finally:
        held.release.set()

    assert job_row(db, body["job_id"])[2] is False  # the vision call never started
    assert used(db, student["id"]) == 0


def test_removing_an_image_after_its_vision_call_started_keeps_the_unit_used(settings, student, db, monkeypatch):
    held = Held(monkeypatch, Gateway, "extract_image_text")
    try:
        with TestClient(create_app(settings), backend_options=LOOP) as c:
            project_id = create_project(c, student["token"])
            body = upload_image(c, student["token"], project_id, "notes-photo.png").json()
            wait_for(lambda: held.started == 1)
            assert job_row(db, body["job_id"])[2] is True

            response = c.delete(
                f"/api/projects/{project_id}/materials/{body['material']['id']}", headers=bearer(student["token"])
            )
            assert response.status_code == 204, response.text

            held.release.set()
            assert wait_for_job(db, body["job_id"]) == "cancelled"
    finally:
        held.release.set()

    assert sections_of(db, body["material"]["id"]) == []
    assert used(db, student["id"]) == 1


def insert_image_job(
    db, account_id: str, project_id: str, status: str, vision_started: bool, day: date | None = None
) -> tuple[str, str]:
    material_id = insert_material(db, account_id, project_id, "processing", created_at="2026-01-01T00:00:00Z")
    db.execute("UPDATE study_materials SET file_type = 'png' WHERE id = %s", (material_id,))
    job_id = db.execute(
        """
        INSERT INTO generation_jobs (account_id, project_id, kind, params, status, vision_started_at, result_ref,
                                     created_at)
        VALUES (%s, %s, 'material_processing', %s::jsonb, %s, CASE WHEN %s THEN now() END, %s,
                now() - interval '1 minute')
        RETURNING id
        """,
        (
            account_id,
            project_id,
            f'{{"file_type": "png", "usage_day": "{(day or today()).isoformat()}", "file_name": "n.png"}}',
            status,
            vision_started,
            material_id,
        ),
    ).fetchone()[0]
    return material_id, str(job_id)


def test_restart_releases_units_only_for_images_whose_call_never_started(settings, client, student, db):
    project_id = create_project(client, student["token"])
    set_used(db, student["id"], 3)
    _, queued = insert_image_job(db, student["id"], project_id, "queued", False)
    _, claimed = insert_image_job(db, student["id"], project_id, "running", False)
    _, reading = insert_image_job(db, student["id"], project_id, "running", True)

    with TestClient(create_app(settings), backend_options=LOOP):
        wait_for(lambda: all(job_row(db, j)[0] == "failed" for j in (queued, claimed, reading)))

    assert used(db, student["id"]) == 1


def test_a_release_counts_against_the_day_the_unit_was_reserved(settings, client, student, db):
    project_id = create_project(client, student["token"])
    yesterday = today() - timedelta(days=1)
    set_used(db, student["id"], 4, yesterday)
    set_used(db, student["id"], 2)
    _, job = insert_image_job(db, student["id"], project_id, "queued", False, yesterday)

    with TestClient(create_app(settings), backend_options=LOOP):
        wait_for(lambda: job_row(db, job)[0] == "failed")

    assert used(db, student["id"], yesterday) == 3
    assert used(db, student["id"]) == 2


# --- Pure parts: normalization, verdict, mock, live request ---


def test_normalize_gives_a_jpeg_capped_at_2048_px():
    big = io.BytesIO()
    Image.new("RGBA", (4000, 1000), (0, 0, 0, 0)).save(big, format="PNG")

    jpeg = images.normalize_sync(big.getvalue(), "png")

    with Image.open(io.BytesIO(jpeg)) as out:
        assert (out.format, out.size, out.mode) == ("JPEG", (2048, 512), "RGB")
        assert out.getpixel((10, 10)) == (255, 255, 255)  # transparency on white


def test_normalize_reads_heic():
    with Image.open(io.BytesIO(images.normalize_sync(heic_bytes((300, 200)), "heic"))) as out:
        assert (out.format, out.size) == ("JPEG", (300, 200))


@pytest.mark.parametrize("data", [b"", b"not an image", b"%PDF-1.4 a pdf with a .png name"])
def test_normalize_refuses_what_it_cannot_decode(data):
    with pytest.raises(Unparseable):
        images.normalize_sync(data, "png")


@pytest.mark.parametrize(("file_type", "fmt"), [("jpg", "PNG"), ("png", "JPEG"), ("heic", "PNG")])
def test_normalize_refuses_content_that_does_not_match_its_extension(file_type, fmt):
    data = io.BytesIO()
    Image.new("RGB", (8, 8), "white").save(data, format=fmt)
    with pytest.raises(Unparseable):
        images.normalize_sync(data.getvalue(), file_type)


def test_an_unknown_quota_timezone_fails_at_startup():
    from pydantic import ValidationError

    with pytest.raises(ValidationError, match="QUOTA_TIMEZONE"):
        Settings(_env_file=None, quota_timezone="Europe/Atlantis")
    assert Settings(_env_file=None, quota_timezone="UTC").quota_timezone == "UTC"


def test_image_text_is_capped():
    from app.llm.schemas import IMAGE_TEXT_MAX

    long = ImageText.model_validate({"legibility": "readable", "text": "x" * (IMAGE_TEXT_MAX + 500)})
    assert len(long.text) == IMAGE_TEXT_MAX


@pytest.mark.parametrize(
    ("legibility", "text", "outcome"),
    [
        ("readable", "x" * 50, "accepted"),
        ("partial", "x" * 50, "accepted_with_warning"),
        ("unreadable", "x" * 500, "rejected"),
        ("readable", "x" * 49, "rejected"),
        ("readable", "   " + "x" * 49 + "   ", "rejected"),
    ],
)
def test_image_verdict(legibility, text, outcome):
    verdict = integrity.judge_image(legibility, text, integrity.Thresholds())
    assert verdict.outcome == outcome
    assert verdict.reason == ("unreadable" if outcome == "rejected" else None)


def test_image_minimum_comes_from_the_settings():
    thresholds = integrity.Thresholds.from_settings(Settings(_env_file=None, integrity_min_image_chars=10))
    assert integrity.judge_image("readable", "x" * 10, thresholds).outcome == "accepted"


@pytest.mark.parametrize(
    ("name", "legibility"),
    [
        ("notes-photo.png", "readable"),
        ("notes-photo-partial.png", "partial"),
        ("NOTES-PHOTO-UNREADABLE.PNG", "unreadable"),
        ("partial.png", "readable"),
    ],
)
def test_mock_outcome_comes_from_the_file_name_only(name, legibility):
    gateway = create_gateway(Settings(_env_file=None, llm_mode="mock"), "mock")
    result = asyncio.run(gateway.extract_image_text(b"ignored", name))
    assert isinstance(result, ImageText)
    assert result.legibility == legibility
    if legibility != "unreadable":
        assert len(result.text.strip()) >= 50


def test_mock_readable_text_passes_the_verdict_and_gets_three_topics():
    assert len(fixtures.IMAGE_READABLE_TEXT.strip()) >= 50
    extracted = Extracted(paged=True, sections=(ExtractedSection("Image", fixtures.IMAGE_READABLE_TEXT),))
    from app.services import topics

    assert topics.target_count(extracted) == 3


def test_live_sends_a_jpeg_data_url_to_the_vision_model(caplog):
    calls: list[dict] = []

    async def create(**kwargs):
        calls.append(kwargs)
        content = '{"legibility": "partial", "text": "Some text"}'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    gateway = Gateway(
        Settings(
            _env_file=None,
            llm_mode="live",
            openrouter_api_key="sk-test",
            llm_text_model="test/text",
            llm_vision_model="test/vision",
        ),
        "live",
        client=client,
    )
    jpeg = images.normalize_sync((TEST_DATA / "notes-photo.png").read_bytes(), "png")

    with caplog.at_level("INFO"):
        result = asyncio.run(gateway.extract_image_text(jpeg, "notes-photo.png"))

    assert (result.legibility, result.text) == ("partial", "Some text")
    (call,) = calls
    assert call["model"] == "test/vision"
    assert call["extra_body"]["provider"]["zdr"] is True
    part = call["messages"][1]["content"][0]
    assert part["type"] == "image_url"
    assert part["image_url"]["url"].startswith("data:image/jpeg;base64,")
    # Logs carry task, model, and outcome only: never the image or its text.
    logged = " ".join(record.getMessage() for record in caplog.records)
    assert "base64" not in logged and "Some text" not in logged


def test_live_without_a_vision_model_fails_at_startup():
    with pytest.raises(ConfigError, match="LLM_VISION_MODEL"):
        create_gateway(
            Settings(_env_file=None, llm_mode="live", openrouter_api_key="sk-test", llm_text_model="test/text"), "live"
        )
