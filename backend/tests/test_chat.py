"""Ask AI: the chat, its scope, and streamed, sourced answers (Story 4.4, FR-16, AD-7, AD-12, AD-18, AD-25).

Runs in mock mode. The "not covered" answer is checked against `test-data/photosynthesis-notes.md`,
uploaded through the normal path; other files are seeded straight into the database. Needs local
Supabase, like test_materials.py.
"""

import asyncio
import json
import uuid
from types import SimpleNamespace

import anyio
import httpx2
import openai
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.api.chats import MessageRequest, prepared_send
from app.db import chats as chats_repo
from app.llm import (
    ChatDelta,
    ChatSources,
    ChatTurn,
    Gateway,
    LLMOutputError,
    ProviderStreamError,
    ProviderUnavailable,
    chat_overhead_tokens,
    estimate_tokens,
)
from app.llm import gateway as gateway_module
from app.llm import fixtures
from app.llm.citations import LabelStripper
from app.main import create_app
from app.services import chat, usage
from tests.test_archive import archive
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
from tests.test_llm import _REQUEST, StubClient
from tests.test_llm import settings as llm_settings
from tests.test_materials import (  # noqa: F401 -- shared fixtures
    create_project,
    insert_material,
    student,
    upload_and_wait,
)
from tests.test_scope import seed

COVERED = "What does the Calvin cycle produce?"
NOT_COVERED = "Who won the football World Cup in 1998?"


# --- Helpers ---


def open_chat(client, token: str, project_id: str):
    return client.get(f"/api/projects/{project_id}/chat", headers=bearer(token))


def chat_of(client, token: str, project_id: str) -> dict:
    response = open_chat(client, token, project_id)
    assert response.status_code == 200, response.text
    return response.json()


def set_scope(client, token: str, chat_id: str, scope: dict):
    return client.patch(f"/api/chats/{chat_id}", json={"scope": scope}, headers=bearer(token))


def send(client, token: str, chat_id: str, text: str):
    return client.post(f"/api/chats/{chat_id}/messages", json={"text": text}, headers=bearer(token))


def events(response) -> list[tuple[str, dict]]:
    """The SSE events of a finished response, keep-alive comments skipped."""
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    found = []
    for block in response.text.replace("\r\n", "\n").split("\n\n"):
        name, data = None, []
        for line in block.split("\n"):
            if line.startswith("event: "):
                name = line[len("event: "):]
            elif line.startswith("data: "):
                data.append(line[len("data: "):])
        if name:
            found.append((name, json.loads("\n".join(data))))
    return found


def ask(client, token: str, chat_id: str, text: str) -> list[tuple[str, dict]]:
    return events(send(client, token, chat_id, text))


def deltas(found) -> str:
    return "".join(data["text"] for name, data in found if name == "delta")


def stored(db, chat_id: str) -> list[tuple]:
    return db.execute(
        """
        SELECT seq, role, text, scope, source_section_ids, material_ids FROM chat_messages
        WHERE chat_id = %s ORDER BY seq
        """,
        (chat_id,),
    ).fetchall()


def used(db, account_id: str) -> int:
    row = db.execute(
        "SELECT count FROM usage_counters WHERE account_id = %s AND usage_day = %s AND kind = 'ask_ai_message'",
        (account_id, usage.usage_day()),
    ).fetchone()
    return row[0] if row else 0


def messages_left(client, token: str) -> int:
    response = client.get("/api/usage", headers=bearer(token))
    assert response.status_code == 200, response.text
    return response.json()["messages_left_today"]


class Capture:
    """Records what `answer_chat_stream` is given, delegating to the real one (or to `replace`)."""

    def __init__(self, monkeypatch, replace=None) -> None:
        self.calls: list[SimpleNamespace] = []
        self.closed = 0
        real = replace or Gateway.answer_chat_stream
        capture = self

        def wrapped(gateway, sections, history, question):
            capture.calls.append(SimpleNamespace(sections=list(sections), history=list(history), question=question))

            async def run():
                inner = real(gateway, sections, history, question)
                try:
                    async for item in inner:
                        yield item
                finally:
                    capture.closed += 1
                    await inner.aclose()

            return run()

        monkeypatch.setattr(Gateway, "answer_chat_stream", wrapped)


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


@pytest.fixture
def notes(client, student, project) -> dict:
    material = upload_and_wait(client, student["token"], project, "photosynthesis-notes.md")
    assert material["status"] == "ready"
    return material


# --- The chat (get-or-create) ---


def test_the_project_chat_is_created_once_with_all_materials_and_no_messages(client, student, db, project):
    first = chat_of(client, student["token"], project)
    again = chat_of(client, student["token"], project)

    assert first == {"id": first["id"], "current_scope": {"all_materials": True}, "messages": []}
    assert again["id"] == first["id"]
    assert db.execute("SELECT count(*) FROM chats WHERE project_id = %s", (project,)).fetchone()[0] == 1


# --- Covered question ---


def test_a_covered_question_streams_a_sourced_answer_and_stores_both_messages(client, student, db, project, notes):
    chat_id = chat_of(client, student["token"], project)["id"]
    assert messages_left(client, student["token"]) == 50

    found = ask(client, student["token"], chat_id, COVERED)

    names = [name for name, _ in found]
    assert names[-1] == "done" and names.count("done") == 1
    assert set(names[:-1]) == {"delta"} and len(names) > 2  # streamed in several chunks
    done = found[-1][1]
    assert len(done["sources"]) >= 1
    assert all(source["label"].startswith("photosynthesis-notes.md · ") for source in done["sources"])
    text = deltas(found)
    # Labels never reach the student, neither in the stream nor in what is stored.
    assert "[S" not in text and text.startswith("From your material:")

    rows = stored(db, chat_id)
    assert [(seq, role) for seq, role, *_ in rows] == [(1, "user"), (2, "assistant")]
    assert rows[0][2] == COVERED and rows[0][4] == [] and rows[0][3] == {"all_materials": True}
    answer = rows[1]
    assert answer[2] == text.strip() and "[S" not in answer[2]
    assert answer[4] and [str(m) for m in answer[5]] == [notes["id"]]
    assert done["message_id"] == str(db.execute("SELECT id FROM chat_messages WHERE chat_id = %s AND seq = 2",
                                                (chat_id,)).fetchone()[0])
    assert used(db, student["id"]) == 1
    assert messages_left(client, student["token"]) == 49

    # A reload shows both messages with the answer's Source labels.
    reloaded = chat_of(client, student["token"], project)
    assert [(m["role"], m["text"]) for m in reloaded["messages"]] == [("user", COVERED), ("assistant", answer[2])]
    assert reloaded["messages"][0]["sources"] == []
    assert reloaded["messages"][1]["sources"] == done["sources"]


def test_a_question_the_notes_dont_cover_is_answered_uncited_stored_and_costs_one(client, student, db, project, notes):
    chat_id = chat_of(client, student["token"], project)["id"]

    found = ask(client, student["token"], chat_id, NOT_COVERED)

    assert found[-1][0] == "done" and found[-1][1]["sources"] == []
    assert deltas(found) == fixtures.CHAT_NOT_COVERED
    rows = stored(db, chat_id)
    assert [(r[1], r[2], r[4], r[5]) for r in rows] == [
        ("user", NOT_COVERED, [], []),
        ("assistant", fixtures.CHAT_NOT_COVERED, [], []),
    ]
    assert used(db, student["id"]) == 1


def test_later_turns_get_the_earlier_ones_and_seq_keeps_counting(client, student, db, project, notes, monkeypatch):
    capture = Capture(monkeypatch)
    chat_id = chat_of(client, student["token"], project)["id"]

    ask(client, student["token"], chat_id, COVERED)
    ask(client, student["token"], chat_id, NOT_COVERED)

    assert capture.calls[0].history == []
    first_answer = stored(db, chat_id)[1][2]
    assert capture.calls[1].history == [ChatTurn("user", COVERED), ChatTurn("assistant", first_answer)]
    assert [r[0] for r in stored(db, chat_id)] == [1, 2, 3, 4]
    assert used(db, student["id"]) == 2


@pytest.mark.parametrize("text", ["", "   ", "x" * 2001])
def test_a_blank_or_too_long_question_is_refused_and_reserves_nothing(client, student, db, project, notes, text):
    chat_id = chat_of(client, student["token"], project)["id"]

    assert_error(send(client, student["token"], chat_id, text), 422, "invalid_request")
    assert used(db, student["id"]) == 0


# --- Scope ---


def test_one_file_scope_answers_only_from_that_file_and_persists_until_broadened(
    client, student, db, project, monkeypatch
):
    capture = Capture(monkeypatch)
    first, _, _ = seed(db, student["id"], project, ["chlorophyll absorbs light"])
    second, second_sections, _ = seed(db, student["id"], project, ["chlorophyll reflects green", "stroma fluid"])
    chat_id = chat_of(client, student["token"], project)["id"]

    response = set_scope(client, student["token"], chat_id, {"material_id": second})
    assert response.status_code == 200, response.text
    assert response.json() == {"id": chat_id, "current_scope": {"material_id": second}}

    ask(client, student["token"], chat_id, "What does chlorophyll do?")
    ask(client, student["token"], chat_id, "What does chlorophyll do?")

    for call in capture.calls:
        assert [str(s.id) for s in call.sections] == second_sections
    rows = stored(db, chat_id)
    assert {json.dumps(r[3]) for r in rows} == {json.dumps({"material_id": second})}
    assert {str(m) for r in rows for m in r[5]} == {second}
    # A reload keeps the scope as it was left.
    assert chat_of(client, student["token"], project)["current_scope"] == {"material_id": second}

    response = set_scope(client, student["token"], chat_id, {"all_materials": True})
    assert response.status_code == 200, response.text
    ask(client, student["token"], chat_id, "What does chlorophyll do?")
    assert {s.material_id for s in capture.calls[-1].sections} == {uuid.UUID(first), uuid.UUID(second)}
    assert stored(db, chat_id)[-1][3] == {"all_materials": True}


def test_a_chat_whose_file_is_no_longer_ready_falls_back_to_all_materials(client, student, db, project):
    material, _, _ = seed(db, student["id"], project, ["alpha"])
    seed(db, student["id"], project, ["beta"])
    chat_id = chat_of(client, student["token"], project)["id"]
    assert set_scope(client, student["token"], chat_id, {"material_id": material}).status_code == 200

    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (material,))

    assert chat_of(client, student["token"], project)["current_scope"] == {"all_materials": True}
    saved = db.execute("SELECT current_scope FROM chats WHERE id = %s", (chat_id,)).fetchone()[0]
    assert saved == {"all_materials": True}


def test_only_a_ready_file_of_the_project_can_be_the_scope(client, gotrue, created, student, db, project):
    processing = insert_material(db, student["id"], project, "processing")
    other = sign_up(gotrue, created)
    other_project = create_project(client, other["access_token"])
    foreign, _, _ = seed(db, other["user"]["id"], other_project, ["a"])
    chat_id = chat_of(client, student["token"], project)["id"]

    for material in (processing, foreign, str(uuid.uuid4())):
        assert_error(set_scope(client, student["token"], chat_id, {"material_id": material}), 404, "not_found")
    for body in ({"all_materials": False}, {"material_id": None}, {"all_materials": True, "material_id": foreign}):
        assert_error(set_scope(client, student["token"], chat_id, body), 422, "invalid_request")
    assert db.execute("SELECT current_scope FROM chats WHERE id = %s", (chat_id,)).fetchone()[0] == {
        "all_materials": True
    }


# --- Context over the budget ---


def test_over_the_budget_only_the_best_matching_sections_that_fit_are_sent(settings, student, db, monkeypatch):
    capture = Capture(monkeypatch)
    filler = "lorem ipsum dolor sit amet " * 90  # ~2430 characters, ~600 tokens each
    texts = [filler + "mitochondria", filler + "chlorophyll pigment", filler + "ribosome"]
    with TestClient(create_app(settings.model_copy(update={"llm_context_budget_tokens": 1000})), backend_options=LOOP) as c:
        project_id = create_project(c, student["token"])
        _, section_ids, _ = seed(db, student["id"], project_id, texts)
        chat_id = chat_of(c, student["token"], project_id)["id"]

        found = ask(c, student["token"], chat_id, "chlorophyll")

    assert found[-1][0] == "done"
    # Two would be ~1200 tokens: only the best full-text match fits.
    assert [str(s.id) for s in capture.calls[0].sections] == [section_ids[1]]


def test_within_the_budget_every_section_of_the_scope_is_sent(client, student, db, project, monkeypatch):
    capture = Capture(monkeypatch)
    _, section_ids, _ = seed(db, student["id"], project, ["alpha", "beta", "gamma"])
    chat_id = chat_of(client, student["token"], project)["id"]

    ask(client, student["token"], chat_id, "unrelated question")

    assert [str(s.id) for s in capture.calls[0].sections] == section_ids


# --- Quota ---


def test_the_51st_message_today_is_refused_and_nothing_is_streamed_or_stored(client, student, db, project, notes):
    chat_id = chat_of(client, student["token"], project)["id"]
    db.execute(
        "INSERT INTO usage_counters (account_id, usage_day, kind, count) VALUES (%s, %s, 'ask_ai_message', 50)",
        (student["id"], usage.usage_day()),
    )
    assert messages_left(client, student["token"]) == 0

    response = send(client, student["token"], chat_id, COVERED)

    assert_error(response, 429, "quota_exceeded")
    assert response.json()["error"]["params"] == {"limit": 50, "kind": "ask_ai_message"}
    assert stored(db, chat_id) == [] and used(db, student["id"]) == 50
    assert not chat.is_busy(uuid.UUID(chat_id))


def test_usage_reports_messages_left_today(client, student, db):
    db.execute(
        "INSERT INTO usage_counters (account_id, usage_day, kind, count) VALUES (%s, %s, 'ask_ai_message', 41)",
        (student["id"], usage.usage_day()),
    )
    assert messages_left(client, student["token"]) == 9


# --- Provider error, disconnect ---


def failing_after(first: str | None):
    async def answer(gateway, sections, history, question):
        if first is not None:
            yield ChatDelta(first)
        raise ProviderStreamError("error chunk")

    return answer


@pytest.mark.parametrize("first", [None, "Partial answer"], ids=["before-stream", "mid-stream"])
def test_a_provider_error_is_an_error_event_stores_nothing_and_releases_the_unit(
    client, student, db, project, notes, monkeypatch, first
):
    Capture(monkeypatch, replace=failing_after(first))
    chat_id = chat_of(client, student["token"], project)["id"]

    found = ask(client, student["token"], chat_id, COVERED)

    assert found[-1] == ("error", {"code": "llm_unavailable"})
    assert deltas(found) == (first or "")
    assert stored(db, chat_id) == []
    assert used(db, student["id"]) == 0
    assert not chat.is_busy(uuid.UUID(chat_id))


def test_a_disconnect_aborts_the_provider_call_stores_nothing_and_releases_the_unit(
    client, student, db, project, notes, monkeypatch
):
    capture = Capture(monkeypatch)

    async def gone(self):
        return True

    monkeypatch.setattr(Request, "is_disconnected", gone)
    chat_id = chat_of(client, student["token"], project)["id"]

    response = send(client, student["token"], chat_id, COVERED)

    assert response.status_code == 200
    assert not any(name in ("done", "delta") for name, _ in events(response))
    assert capture.closed == 1
    assert stored(db, chat_id) == []
    assert used(db, student["id"]) == 0
    assert not chat.is_busy(uuid.UUID(chat_id))


def test_no_pool_connection_is_checked_out_while_the_answer_streams(client, student, db, project, notes, monkeypatch):
    pool = client.app.state.pool
    seen: list[int] = []

    async def answer(gateway, sections, history, question):
        for word in ("One ", "two ", "three"):
            stats = pool.get_stats()
            seen.append(stats["pool_size"] - stats["pool_available"])
            yield ChatDelta(word)
        yield ChatSources(())

    Capture(monkeypatch, replace=answer)
    chat_id = chat_of(client, student["token"], project)["id"]

    found = ask(client, student["token"], chat_id, COVERED)

    assert found[-1][0] == "done"
    assert seen == [0, 0, 0]


# --- Busy, read-only, no Ready file, foreign ---


def test_a_second_send_while_streaming_is_chat_busy_and_reserves_nothing(client, student, db, project, notes):
    chat_id = chat_of(client, student["token"], project)["id"]
    chat._busy.add(uuid.UUID(chat_id))
    try:
        assert_error(send(client, student["token"], chat_id, COVERED), 409, "chat_busy")
    finally:
        chat._busy.discard(uuid.UUID(chat_id))
    assert used(db, student["id"]) == 0

    assert ask(client, student["token"], chat_id, COVERED)[-1][0] == "done"


def test_two_sends_at_once_stream_one_answer(settings, student, db):
    slow = settings.model_copy(update={"llm_mock_delay_ms": 800})
    with TestClient(create_app(slow), backend_options=LOOP) as c:
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, ["chlorophyll absorbs light"])
        chat_id = chat_of(c, student["token"], project_id)["id"]

        async def both():
            transport = httpx2.ASGITransport(app=c.app)
            async with httpx2.AsyncClient(transport=transport, base_url="http://test") as http:
                body = {"text": "What does chlorophyll do?"}
                url = f"/api/chats/{chat_id}/messages"
                first = asyncio.create_task(http.post(url, json=body, headers=bearer(student["token"])))
                await asyncio.sleep(0.4)
                second = await http.post(url, json=body, headers=bearer(student["token"]))
                return await first, second

        first, second = c.portal.call(both)

    assert first.status_code == 200 and "event: done" in first.text
    assert_error(second, 409, "chat_busy")
    assert len(stored(db, chat_id)) == 2 and used(db, student["id"]) == 1


def test_a_read_only_project_shows_its_thread_but_refuses_sends_and_scope_changes(
    client, student, db, project, notes
):
    chat_id = chat_of(client, student["token"], project)["id"]
    ask(client, student["token"], chat_id, COVERED)
    assert archive(client, student["token"], project).status_code == 200

    thread = chat_of(client, student["token"], project)
    assert [m["role"] for m in thread["messages"]] == ["user", "assistant"]
    assert_error(send(client, student["token"], chat_id, COVERED), 409, "project_read_only")
    assert_error(set_scope(client, student["token"], chat_id, {"material_id": notes["id"]}), 409, "project_read_only")
    assert used(db, student["id"]) == 1 and len(stored(db, chat_id)) == 2


def test_with_no_ready_file_a_send_is_insufficient_material_and_reserves_nothing(client, student, db, project):
    insert_material(db, student["id"], project, "processing")
    chat_id = chat_of(client, student["token"], project)["id"]

    assert_error(send(client, student["token"], chat_id, COVERED), 422, "insufficient_material")
    assert used(db, student["id"]) == 0 and stored(db, chat_id) == []
    assert not chat.is_busy(uuid.UUID(chat_id))


def test_another_accounts_chat_is_not_found(client, gotrue, created, student, db, project, notes):
    chat_id = chat_of(client, student["token"], project)["id"]
    other = sign_up(gotrue, created)["access_token"]

    assert_error(open_chat(client, other, project), 404, "not_found")
    assert_error(set_scope(client, other, chat_id, {"all_materials": True}), 404, "not_found")
    assert_error(send(client, other, chat_id, COVERED), 404, "not_found")
    assert_error(send(client, student["token"], str(uuid.uuid4()), COVERED), 404, "not_found")
    assert stored(db, chat_id) == []


@pytest.mark.parametrize("table", ["chats", "chat_messages"])
def test_the_data_api_cannot_read_chats(client, settings, student, project, notes, table):
    # AD-1: the browser's Supabase keys never reach app data.
    chat_id = chat_of(client, student["token"], project)["id"]
    ask(client, student["token"], chat_id, COVERED)
    response = httpx2.get(
        f"{settings.supabase_url}/rest/v1/{table}",
        headers={"apikey": settings.supabase_publishable_key, **bearer(student["token"])},
        timeout=10,
    )
    assert response.status_code in (401, 403, 404) or response.json() == [], response.text


# --- Labels and the gateway (no database) ---


def run(coro):
    return asyncio.run(coro)


def strip_all(chunks: list[str]) -> tuple[str, list[int], list[str]]:
    stripper = LabelStripper()
    out = [stripper.feed(chunk) for chunk in chunks]
    out.append(stripper.flush())
    return "".join(out), stripper.numbers, out


@pytest.mark.parametrize(
    "chunks",
    [
        ["Light is absorbed [S1]. Water is split [S2, S3]."],
        ["Light is absorbed [", "S1]. Water is split [S", "2, S", "3]."],
        ["Light is absorbed ", "[S1", "]. Water is split", " ", "[S2][S3]."],
    ],
    ids=["whole", "split-labels", "split-space"],
)
def test_labels_are_stripped_with_their_space_even_across_chunk_edges(chunks):
    text, numbers, out = strip_all(chunks)
    assert text == "Light is absorbed. Water is split."
    assert numbers == [1, 2, 3]
    assert not any("[" in part for part in out)


def test_a_bracket_that_never_becomes_a_label_is_kept_as_text():
    text, numbers, _ = strip_all(["See [Figure 2] and [S", "x] and a trailing [S"])
    assert text == "See [Figure 2] and [Sx] and a trailing [S"
    assert numbers == []


async def collect(gateway: Gateway, sections, question: str, history=()) -> tuple[str, tuple]:
    text, cited = "", ()
    async for item in gateway.answer_chat_stream(sections, history, question):
        if isinstance(item, ChatDelta):
            assert "[S" not in item.text
            text += item.text
        else:
            cited = item.section_ids
    return text, cited


SECTIONS = [
    SimpleNamespace(id="a", label="Page 1", text="Chlorophyll absorbs blue and red light."),
    SimpleNamespace(id="b", label="Page 2", text="The Calvin cycle builds sugar."),
]


def test_the_mock_cites_s1_and_s2_when_the_question_shares_a_word():
    gateway = Gateway(llm_settings(llm_mode="mock"), "mock")
    text, cited = run(collect(gateway, SECTIONS, "Which light does chlorophyll absorb?"))
    assert cited == ("a", "b")
    assert text == "From your material: Chlorophyll absorbs blue and red light.\n\nAlso: The Calvin cycle builds sugar."


def test_the_mock_says_not_covered_with_no_sources_otherwise():
    gateway = Gateway(llm_settings(llm_mode="mock"), "mock")
    assert run(collect(gateway, SECTIONS, NOT_COVERED)) == (fixtures.CHAT_NOT_COVERED, ())


def chunk(content=None, finish_reason=None, error=None):
    choices = [] if content is None and finish_reason is None else [
        SimpleNamespace(delta=SimpleNamespace(content=content), finish_reason=finish_reason)
    ]
    return SimpleNamespace(choices=choices, error=error, model_extra={})


class FakeStream:
    def __init__(self, chunks) -> None:
        self.chunks = list(chunks)
        self.closed = False

    def __aiter__(self):
        return self._iter()

    async def _iter(self):
        for item in self.chunks:
            yield item

    async def close(self):
        self.closed = True


class StreamClient(StubClient):
    def __init__(self, stream) -> None:
        super().__init__()
        self.stream = stream

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return self.stream


def live_gateway(stream) -> tuple[Gateway, StreamClient]:
    client = StreamClient(stream)
    settings = llm_settings(llm_mode="live", openrouter_api_key="sk-test", llm_text_model="m", llm_vision_model="v")
    return Gateway(settings, "live", client=client), client


def test_live_streams_maps_labels_drops_unknown_ones_and_sends_history_and_privacy_flags():
    stream = FakeStream([chunk("Chlorophyll absorbs light [S"), chunk("1]. Sugar is built [S9]"), chunk(" [S2].")])
    gateway, client = live_gateway(stream)

    text, cited = run(collect(gateway, SECTIONS, "What happens?", [ChatTurn("user", "Hi"), ChatTurn("assistant", "Hello")]))

    assert text == "Chlorophyll absorbs light. Sugar is built."
    assert cited == ("a", "b")
    call = client.calls[0]
    assert call["stream"] is True
    assert call["extra_body"]["provider"] == {"require_parameters": True, "data_collection": "deny", "zdr": True}
    roles = [m["role"] for m in call["messages"]]
    assert roles == ["system", "user", "assistant", "user"]
    assert call["messages"][-1]["content"].startswith("[S1]")
    assert call["messages"][-1]["content"].endswith("Question: What happens?")
    assert stream.closed


@pytest.mark.parametrize(
    "bad", [chunk(error={"code": 502, "message": "upstream"}), chunk(finish_reason="error")], ids=["error", "finish"]
)
def test_a_mid_stream_error_chunk_is_a_provider_stream_error(bad):
    stream = FakeStream([chunk("Partial "), bad])
    gateway, _ = live_gateway(stream)
    with pytest.raises(ProviderStreamError):
        run(collect(gateway, SECTIONS, "What happens?"))
    assert stream.closed


def test_closing_the_answer_early_closes_the_provider_stream():
    stream = FakeStream([chunk("One "), chunk("two "), chunk("three")])
    gateway, _ = live_gateway(stream)

    async def first_only():
        answer = gateway.answer_chat_stream(SECTIONS, [], "What happens?")
        item = await anext(answer)
        await answer.aclose()
        return item

    assert run(first_only()) == ChatDelta("One")
    assert stream.closed


def test_a_provider_error_before_the_stream_is_unavailable():
    gateway, _ = live_gateway(None)

    async def refuse(**kwargs):
        raise openai.APIConnectionError(request=_REQUEST)

    gateway._client.chat.completions.create = refuse
    with pytest.raises(ProviderUnavailable):
        run(collect(gateway, SECTIONS, "What happens?"))


# --- Review follow-ups: the settle paths, the budget, history pairs ---


def replaced(answer):
    """A stand-in `answer_chat_stream` from a plain async generator function of nothing."""

    async def stand_in(gateway, sections, history, question):
        async for item in answer():
            yield item

    return stand_in


def assert_nothing_kept(db, student, chat_id):
    assert stored(db, chat_id) == []
    assert used(db, student["id"]) == 0
    assert not chat.is_busy(uuid.UUID(chat_id))


def test_an_answer_empty_after_stripping_is_llm_unavailable(client, student, db, project, notes, monkeypatch):
    async def labels_only():
        yield ChatSources(())

    Capture(monkeypatch, replace=replaced(labels_only))
    chat_id = chat_of(client, student["token"], project)["id"]

    assert ask(client, student["token"], chat_id, COVERED) == [("error", {"code": "llm_unavailable"})]
    assert_nothing_kept(db, student, chat_id)


def test_a_failed_save_is_internal_error(client, student, db, project, notes, monkeypatch):
    async def broken(*args, **kwargs):
        raise RuntimeError("insert failed")

    monkeypatch.setattr(chats_repo, "insert_turn", broken)
    chat_id = chat_of(client, student["token"], project)["id"]

    assert ask(client, student["token"], chat_id, COVERED)[-1] == ("error", {"code": "internal_error"})
    assert_nothing_kept(db, student, chat_id)


def test_a_chat_deleted_mid_stream_is_not_found(client, student, db, project, notes, monkeypatch):
    chat_id = chat_of(client, student["token"], project)["id"]

    async def then_gone():
        yield ChatDelta("Some words.")
        db.execute("DELETE FROM chats WHERE id = %s", (chat_id,))
        yield ChatSources(())

    Capture(monkeypatch, replace=replaced(then_gone))

    assert ask(client, student["token"], chat_id, COVERED)[-1] == ("error", {"code": "not_found"})
    assert_nothing_kept(db, student, chat_id)


def test_a_project_deleted_mid_stream_saves_nothing_but_an_archived_one_still_saves(
    client, student, db, project, notes, monkeypatch
):
    chat_id = chat_of(client, student["token"], project)["id"]
    column = {"value": "deleted_at"}

    async def then_read_only():
        yield ChatDelta("Some words.")
        db.execute(f"UPDATE projects SET {column['value']} = now() WHERE id = %s", (project,))
        yield ChatSources(())

    Capture(monkeypatch, replace=replaced(then_read_only))

    assert ask(client, student["token"], chat_id, COVERED)[-1] == ("error", {"code": "project_read_only"})
    assert_nothing_kept(db, student, chat_id)

    db.execute("UPDATE projects SET deleted_at = NULL WHERE id = %s", (project,))
    column["value"] = "archived_at"
    assert ask(client, student["token"], chat_id, COVERED)[-1][0] == "done"
    assert len(stored(db, chat_id)) == 2 and used(db, student["id"]) == 1


@pytest.mark.parametrize(
    ("error", "code"),
    [(LLMOutputError("bad"), "llm_unavailable"), (RuntimeError("bug"), "internal_error")],
    ids=["llm-error", "unexpected"],
)
def test_any_other_failure_still_ends_with_an_error_event(client, student, db, project, notes, monkeypatch, error, code):
    async def failing():
        yield ChatDelta("Partial ")
        raise error

    Capture(monkeypatch, replace=replaced(failing))
    chat_id = chat_of(client, student["token"], project)["id"]

    found = ask(client, student["token"], chat_id, COVERED)

    assert found == [("delta", {"text": "Partial "}), ("error", {"code": code})]
    assert_nothing_kept(db, student, chat_id)


def test_a_disconnect_after_the_last_words_stores_nothing(client, student, db, project, notes, monkeypatch):
    capture = Capture(monkeypatch)

    async def gone_once_answered(self):
        return capture.closed > 0  # the answer has ended, the save hasn't started

    monkeypatch.setattr(Request, "is_disconnected", gone_once_answered)
    chat_id = chat_of(client, student["token"], project)["id"]

    found = events(send(client, student["token"], chat_id, COVERED))

    assert found and {name for name, _ in found} == {"delta"}
    assert_nothing_kept(db, student, chat_id)


def test_a_cancel_during_the_save_still_saves_and_keeps_the_unit(client, student, db, project, notes, monkeypatch):
    chat_id = chat_of(client, student["token"], project)["id"]
    real = chats_repo.insert_turn
    holder = {}

    async def cancelling(*args, **kwargs):
        holder["scope"].cancel()
        await anyio.sleep(0)
        return await real(*args, **kwargs)

    monkeypatch.setattr(chats_repo, "insert_turn", cancelling)

    async def never_gone():
        return False

    async def run():
        state = client.app.state
        pending = await chat.prepare_send(state.pool, uuid.UUID(student["id"]), uuid.UUID(chat_id), COVERED, 100_000)
        names = []
        with anyio.CancelScope() as scope:
            holder["scope"] = scope
            answer = chat.stream(state.pool, state.llm, pending, never_gone)
            try:
                async for name, _ in answer:
                    names.append(name)
            finally:
                with anyio.CancelScope(shield=True):
                    await answer.aclose()
        return names

    client.portal.call(run)

    assert [row[1] for row in stored(db, chat_id)] == ["user", "assistant"]
    assert used(db, student["id"]) == 1
    assert not chat.is_busy(uuid.UUID(chat_id))


def test_the_send_dependency_releases_a_send_whose_stream_never_starts(client, student, db, project, notes):
    chat_id = chat_of(client, student["token"], project)["id"]

    async def run():
        request = SimpleNamespace(app=client.app)
        user = SimpleNamespace(account_id=uuid.UUID(student["id"]))
        dependency = prepared_send(request, uuid.UUID(chat_id), MessageRequest(text=COVERED), user)
        await anext(dependency)
        during = (used(db, student["id"]), chat.is_busy(uuid.UUID(chat_id)))
        await dependency.aclose()
        return during

    assert client.portal.call(run) == (1, True)
    assert_nothing_kept(db, student, chat_id)


def budget_client(settings):
    return TestClient(create_app(settings.model_copy(update={"llm_context_budget_tokens": 1000})), backend_options=LOOP)


SECTION_TOKENS = 200


def section_texts(n: int) -> list[str]:
    """`n` Sections of exactly SECTION_TOKENS estimated tokens, each mentioning chlorophyll."""
    return [f"chlorophyll {k} ".ljust(SECTION_TOKENS * 4, "x") for k in range(n)]


def test_the_prompt_and_the_question_shrink_the_room_for_sections(settings, student, db, monkeypatch):
    capture = Capture(monkeypatch)
    question = "chlorophyll " + "y" * 1500
    with budget_client(settings) as c:
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, section_texts(6))
        chat_id = chat_of(c, student["token"], project_id)["id"]
        assert ask(c, student["token"], chat_id, question)[-1][0] == "done"

    room = 1000 - chat_overhead_tokens(question)
    assert 0 < room < 1000 - SECTION_TOKENS
    assert len(capture.calls[0].sections) == room // SECTION_TOKENS


def test_a_section_too_big_alone_is_sent_cut_to_fit(settings, student, db, monkeypatch):
    capture = Capture(monkeypatch)
    with budget_client(settings) as c:
        project_id = create_project(c, student["token"])
        _, section_ids, _ = seed(db, student["id"], project_id, ["chlorophyll " + "z" * 8000])
        chat_id = chat_of(c, student["token"], project_id)["id"]
        assert ask(c, student["token"], chat_id, "chlorophyll")[-1][0] == "done"

    (sent,) = capture.calls[0].sections
    room = 1000 - chat_overhead_tokens("chlorophyll")
    assert str(sent.id) == section_ids[0]
    assert len(sent.text) == room * 4 and sent.text.startswith("chlorophyll ")


def add_turn(db, chat_id: str, seq: int, question: str, answer: str) -> None:
    for offset, (role, text) in enumerate((("user", question), ("assistant", answer))):
        db.execute(
            "INSERT INTO chat_messages (chat_id, seq, role, scope, text) VALUES (%s, %s, %s, %s, %s)",
            (chat_id, seq + offset, role, json.dumps({"all_materials": True}), text),
        )


def test_history_takes_whole_pairs_newest_first_and_the_sections_get_what_is_left(settings, student, db, monkeypatch):
    capture = Capture(monkeypatch)
    old = ("q" * 400, "a" * 400)  # 200 tokens: never fits next to the newer pairs
    middle = ("Q" * 200, "A" * 200)  # 100 tokens
    newest = ("N" * 100, "M" * 400)  # 125 tokens; with `middle` 225, over the 200 cap
    with budget_client(settings) as c:
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, section_texts(6))
        chat_id = chat_of(c, student["token"], project_id)["id"]
        for seq, (question, answer) in zip((1, 3, 5), (old, middle, newest)):
            add_turn(db, chat_id, seq, question, answer)
        assert ask(c, student["token"], chat_id, "chlorophyll")[-1][0] == "done"

    call = capture.calls[0]
    # Only the newest whole pair fits in 1000 // 5; the middle pair's answer alone would have, too.
    assert call.history == [ChatTurn("user", newest[0]), ChatTurn("assistant", newest[1])]
    history_tokens = estimate_tokens(list(newest))
    room = 1000 - chat_overhead_tokens("chlorophyll") - history_tokens
    assert len(call.sections) == room // SECTION_TOKENS


def test_history_pairs_that_fit_are_passed_oldest_first(settings, student, db, monkeypatch):
    capture = Capture(monkeypatch)
    pairs = [(f"question {k} " + "q" * 100, f"answer {k} " + "a" * 100) for k in range(4)]  # ~55 tokens each
    with budget_client(settings) as c:
        project_id = create_project(c, student["token"])
        seed(db, student["id"], project_id, ["chlorophyll"])
        chat_id = chat_of(c, student["token"], project_id)["id"]
        for k, (question, answer) in enumerate(pairs):
            add_turn(db, chat_id, 2 * k + 1, question, answer)
        assert ask(c, student["token"], chat_id, "chlorophyll")[-1][0] == "done"

    kept = pairs[1:]  # three pairs fit in 200 tokens, four don't
    assert sum(estimate_tokens(list(p)) for p in kept) <= 200 < sum(estimate_tokens(list(p)) for p in pairs)
    assert capture.calls[0].history == [ChatTurn(role, text) for q, a in kept for role, text in (("user", q), ("assistant", a))]


# --- Review follow-ups: labels at line starts, the live stream's limits ---


@pytest.mark.parametrize(
    ("chunks", "expected"),
    [
        (["First line.\n[S1] Second line."], "First line.\n Second line."),
        (["One paragraph. [S1]\n\n[S2]", "Next paragraph."], "One paragraph.\n\nNext paragraph."),
        (["Ends here.\n", "[S", "3]\nStarts here."], "Ends here.\n\nStarts here."),
    ],
    ids=["line-start", "paragraph-break", "split-at-line-start"],
)
def test_a_label_never_takes_the_line_break_before_it(chunks, expected):
    text, numbers, _ = strip_all(chunks)
    assert text == expected
    assert numbers


class SlowStream(FakeStream):
    async def _iter(self):
        for item in self.chunks:
            await asyncio.sleep(0.2)
            yield item


def test_live_sends_a_max_tokens_cap():
    gateway, client = live_gateway(FakeStream([chunk("Hi.")]))
    run(collect(gateway, SECTIONS, "What happens?"))
    assert client.calls[0]["max_tokens"] == gateway_module.CHAT_MAX_TOKENS == 1500


def test_an_answer_past_the_deadline_is_a_provider_stream_error(monkeypatch):
    monkeypatch.setattr(gateway_module, "CHAT_STREAM_DEADLINE_SECONDS", 0.3)
    stream = SlowStream([chunk("One "), chunk("two "), chunk("three")])
    gateway, _ = live_gateway(stream)

    with pytest.raises(ProviderStreamError):
        run(collect(gateway, SECTIONS, "What happens?"))
    assert stream.closed


def test_a_broken_connection_mid_stream_is_a_provider_stream_error():
    class Broken(FakeStream):
        async def _iter(self):
            yield chunk("One ")
            raise httpx2.ReadError("connection reset")

    stream = Broken([])
    gateway, _ = live_gateway(stream)
    with pytest.raises(ProviderStreamError):
        run(collect(gateway, SECTIONS, "What happens?"))
    assert stream.closed
