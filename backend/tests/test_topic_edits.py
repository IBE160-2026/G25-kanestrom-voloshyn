"""Edit the Topics in each file (Story 2.6b, FR-22, AD-21, AD-22).

Files are seeded straight into the database (a Ready Material, its Sections, and its Topics with their
links), so each test states the exact Topics it starts from. One test goes through a real upload in mock
mode. Needs local Supabase, like test_materials.py.
"""

import uuid

import pytest

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
    student,
    upload_and_wait,
)


def seed(db, account_id: str, project_id: str, topics: list[list[int]], sections: int | None = None, status="ready"):
    """A Material with `sections` Sections and one Topic per entry of `topics`, each linked to the Section
    positions it lists. Returns (material_id, [topic_id, ...])."""
    material_id = insert_material(db, account_id, project_id, status)
    count = sections if sections is not None else max([p for t in topics for p in t], default=-1) + 1
    section_ids = [
        str(
            db.execute(
                "INSERT INTO sections (material_id, position, label, text) VALUES (%s, %s, %s, 'text') RETURNING id",
                (material_id, n, f"Page {n + 1}"),
            ).fetchone()[0]
        )
        for n in range(count)
    ]
    topic_ids = []
    for position, positions in enumerate(topics):
        topic_id = str(
            db.execute(
                "INSERT INTO topics (material_id, label, group_label, position) VALUES (%s, %s, %s, %s) RETURNING id",
                (material_id, f"Topic {position + 1}", "Part 1" if position == 0 else None, position),
            ).fetchone()[0]
        )
        for p in positions:
            db.execute("INSERT INTO topic_sections (topic_id, section_id) VALUES (%s, %s)", (topic_id, section_ids[p]))
        topic_ids.append(topic_id)
    return material_id, topic_ids


def saved(db, material_id: str) -> list[tuple[str, str, int, str | None, list[int]]]:
    """(id, label, position, group_label, [section positions]) per Topic, in order."""
    rows = db.execute(
        """
        SELECT t.id, t.label, t.position, t.group_label,
               coalesce(array_agg(s.position ORDER BY s.position) FILTER (WHERE s.id IS NOT NULL), '{}')
        FROM topics t
        LEFT JOIN topic_sections ts ON ts.topic_id = t.id
        LEFT JOIN sections s ON s.id = ts.section_id
        WHERE t.material_id = %s GROUP BY t.id ORDER BY t.position
        """,
        (material_id,),
    ).fetchall()
    return [(str(i), label, pos, group, list(sections)) for i, label, pos, group, sections in rows]


def uncovered(db, material_id: str) -> int:
    return db.execute(
        """
        SELECT count(*) FROM sections s WHERE s.material_id = %s
        AND NOT EXISTS (SELECT 1 FROM topic_sections ts WHERE ts.section_id = s.id)
        """,
        (material_id,),
    ).fetchone()[0]


def rename(client, token, project_id, topic_id, label):
    return client.patch(f"/api/projects/{project_id}/topics/{topic_id}", json={"label": label}, headers=bearer(token))


def delete(client, token, project_id, topic_id):
    return client.delete(f"/api/projects/{project_id}/topics/{topic_id}", headers=bearer(token))


def merge(client, token, project_id, topic_ids):
    return client.post(f"/api/projects/{project_id}/topics/merge", json={"topic_ids": topic_ids}, headers=bearer(token))


def add(client, token, project_id, material_id, label):
    return client.post(
        f"/api/projects/{project_id}/materials/{material_id}/topics", json={"label": label}, headers=bearer(token)
    )


def ok(response) -> dict:
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def project(client, student) -> str:
    return create_project(client, student["token"])


# --- Rename ---


def test_rename_trims_the_label_and_changes_nothing_else(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0], [1], [2]])
    before = saved(db, material_id)

    body = ok(rename(client, student["token"], project, ids[1], "  Cell cycle "))

    after = saved(db, material_id)
    assert after[1][1] == "Cell cycle"
    assert [row for i, row in enumerate(after) if i != 1] == [row for i, row in enumerate(before) if i != 1]
    assert after[1][2:] == before[1][2:]
    assert body["material_id"] == material_id
    assert [t["label"] for t in body["topics"]] == ["Topic 1", "Cell cycle", "Topic 3"]
    assert set(body["topics"][0]) == {"id", "label", "group_label", "position"}


@pytest.mark.parametrize("label", ["", "   ", "x" * 101])
def test_rename_refuses_blank_or_over_100(client, student, db, project, label):
    material_id, ids = seed(db, student["id"], project, [[0], [1], [2]])
    before = saved(db, material_id)

    assert_error(rename(client, student["token"], project, ids[0], label), 422, "invalid_name")
    assert saved(db, material_id) == before


def test_rename_accepts_exactly_100(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0]])

    body = ok(rename(client, student["token"], project, ids[0], "x" * 100))

    assert body["topics"][0]["label"] == "x" * 100


# --- Delete ---


def test_delete_keeps_its_sections_covered_by_the_topic_before(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0], [1, 2], [3]])

    body = ok(delete(client, student["token"], project, ids[1]))

    after = saved(db, material_id)
    assert [row[0] for row in after] == [ids[0], ids[2]]
    assert after[0][4] == [0, 1, 2]
    assert after[1][4] == [3]
    assert uncovered(db, material_id) == 0
    assert [t["id"] for t in body["topics"]] == [ids[0], ids[2]]


def test_delete_of_the_first_topic_hands_its_sections_to_the_next(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0, 1], [2], [3]])

    ok(delete(client, student["token"], project, ids[0]))

    assert [row[4] for row in saved(db, material_id)] == [[0, 1, 2], [3]]
    assert uncovered(db, material_id) == 0


def test_delete_moves_only_sections_no_other_topic_covers(client, student, db, project):
    # The mock's short-file case: three Topics share one Section.
    material_id, ids = seed(db, student["id"], project, [[0, 1], [1], [2]])

    ok(delete(client, student["token"], project, ids[1]))

    assert [row[4] for row in saved(db, material_id)] == [[0, 1], [2]]


def test_delete_refuses_the_last_topic(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0, 1]])
    before = saved(db, material_id)

    assert_error(delete(client, student["token"], project, ids[0]), 422, "topic_last_cannot_delete")
    assert saved(db, material_id) == before


# --- Merge ---


def test_merge_keeps_the_lowest_position_with_the_union_of_sections(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0, 1], [2], [3, 4], [5]])

    body = ok(merge(client, student["token"], project, [ids[2], ids[0]]))

    after = saved(db, material_id)
    assert [row[0] for row in after] == [ids[0], ids[1], ids[3]]
    survivor = after[0]
    assert (survivor[1], survivor[2], survivor[3]) == ("Topic 1", 0, "Part 1")
    assert survivor[4] == [0, 1, 3, 4]
    assert uncovered(db, material_id) == 0
    assert [t["id"] for t in body["topics"]] == [ids[0], ids[1], ids[3]]


def test_merge_of_topics_sharing_a_section_keeps_one_link(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0], [0], [0]])

    ok(merge(client, student["token"], project, ids))

    assert [row[4] for row in saved(db, material_id)] == [[0]]


@pytest.mark.parametrize("which", ["one", "same twice", "none"])
def test_merge_needs_two_distinct_topics(client, student, db, project, which):
    material_id, ids = seed(db, student["id"], project, [[0], [1]])
    before = saved(db, material_id)
    topic_ids = {"one": [ids[0]], "same twice": [ids[0], ids[0]], "none": []}[which]

    assert_error(merge(client, student["token"], project, topic_ids), 422, "invalid_request")
    assert saved(db, material_id) == before


def test_merge_across_files_is_refused(client, student, db, project):
    first, first_ids = seed(db, student["id"], project, [[0], [1]])
    second, second_ids = seed(db, student["id"], project, [[0], [1]])
    before = (saved(db, first), saved(db, second))

    response = merge(client, student["token"], project, [first_ids[0], second_ids[0]])

    assert_error(response, 422, "topic_merge_cross_material")
    assert (saved(db, first), saved(db, second)) == before


# --- Add ---


def test_add_places_a_student_topic_last_with_no_sections(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0], [1], [2]])

    body = ok(add(client, student["token"], project, material_id, "  Mitosis  "))

    after = saved(db, material_id)
    assert len(after) == 4
    assert (after[3][1], after[3][2], after[3][3], after[3][4]) == ("Mitosis", 3, None, [])
    origin = db.execute("SELECT origin FROM topics WHERE id = %s", (after[3][0],)).fetchone()[0]
    assert origin == "student"
    assert [t["label"] for t in body["topics"]][-1] == "Mitosis"


def test_add_after_a_delete_stays_last_with_unique_positions(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0], [1], [2]])
    ok(delete(client, student["token"], project, ids[2]))

    ok(add(client, student["token"], project, material_id, "New"))

    after = saved(db, material_id)
    assert [row[1] for row in after] == ["Topic 1", "Topic 2", "New"]
    assert len({row[2] for row in after}) == 3


def test_add_refuses_the_101st(client, student, db, project):
    material_id, _ = seed(db, student["id"], project, [[0]] + [[] for _ in range(99)], sections=1)
    before = saved(db, material_id)

    assert_error(add(client, student["token"], project, material_id, "One more"), 422, "topic_limit_reached")
    assert saved(db, material_id) == before


def test_add_refuses_a_blank_label(client, student, db, project):
    material_id, _ = seed(db, student["id"], project, [[0]])

    assert_error(add(client, student["token"], project, material_id, "  "), 422, "invalid_name")
    assert len(saved(db, material_id)) == 1


@pytest.mark.parametrize("status", ["processing", "rejected"])
def test_add_needs_a_ready_file(client, student, db, project, status):
    material_id = insert_material(db, student["id"], project, status)

    assert_error(add(client, student["token"], project, material_id, "Topic"), 404, "not_found")
    assert saved(db, material_id) == []


# --- Foreign, removed, and read-only ---


def test_foreign_topics_and_files_are_not_found(client, gotrue, created, student, db, project):
    other = sign_up(gotrue, created)
    foreign_project = create_project(client, other["access_token"])
    material_id, ids = seed(db, other["user"]["id"], foreign_project, [[0], [1]])
    before = saved(db, material_id)
    token = student["token"]
    own_material, own_ids = seed(db, student["id"], project, [[0], [1]])

    assert_error(rename(client, token, project, ids[0], "Mine"), 404, "not_found")
    assert_error(delete(client, token, project, ids[0]), 404, "not_found")
    assert_error(merge(client, token, project, ids), 404, "not_found")
    assert_error(merge(client, token, project, [own_ids[0], ids[0]]), 404, "not_found")
    assert_error(add(client, token, project, material_id, "Mine"), 404, "not_found")
    # The other Account's own Project in the URL is not found either.
    assert_error(rename(client, token, foreign_project, ids[0], "Mine"), 404, "not_found")
    assert_error(rename(client, token, project, str(uuid.uuid4()), "Mine"), 404, "not_found")
    assert saved(db, material_id) == before
    assert len(saved(db, own_material)) == 2


def test_a_topic_of_another_project_of_the_same_account_is_not_found(client, student, db, project):
    other_project = create_project(client, student["token"])
    material_id, ids = seed(db, student["id"], other_project, [[0], [1]])

    assert_error(rename(client, student["token"], project, ids[0], "Moved"), 404, "not_found")
    assert_error(add(client, student["token"], project, material_id, "Moved"), 404, "not_found")
    assert saved(db, material_id)[0][1] == "Topic 1"


def test_a_removed_files_topics_are_not_found(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0], [1]])
    db.execute("UPDATE study_materials SET removed_at = now() WHERE id = %s", (material_id,))
    before = saved(db, material_id)
    token = student["token"]

    assert_error(rename(client, token, project, ids[0], "Gone"), 404, "not_found")
    assert_error(delete(client, token, project, ids[0]), 404, "not_found")
    assert_error(merge(client, token, project, ids), 404, "not_found")
    assert_error(add(client, token, project, material_id, "Gone"), 404, "not_found")
    assert saved(db, material_id) == before


@pytest.mark.parametrize("column", ["archived_at", "deleted_at"])
def test_read_only_project_refuses_every_edit(client, student, db, project, column):
    material_id, ids = seed(db, student["id"], project, [[0], [1]])
    db.execute(f"UPDATE projects SET {column} = now() WHERE id = %s", (project,))
    before = saved(db, material_id)
    token = student["token"]

    assert_error(rename(client, token, project, ids[0], "Nope"), 409, "project_read_only")
    assert_error(delete(client, token, project, ids[0]), 409, "project_read_only")
    assert_error(merge(client, token, project, ids), 409, "project_read_only")
    assert_error(add(client, token, project, material_id, "Nope"), 409, "project_read_only")
    assert saved(db, material_id) == before


# --- Persistence ---


def test_edits_on_an_uploaded_file_persist_and_reopen_in_the_same_order(client, student, db, project):
    token = student["token"]
    material = upload_and_wait(client, token, project, "photosynthesis-lecture.pdf")
    ids = [t["id"] for t in material["topics"]]
    assert len(ids) == 3

    ok(rename(client, token, project, ids[2], "Calvin cycle"))
    ok(merge(client, token, project, [ids[0], ids[1]]))
    ok(add(client, token, project, material["id"], "Exam notes"))
    last = ok(delete(client, token, project, ids[2]))

    again = materials_of(client, token, project)[0]
    assert again["topics"] == last["topics"]
    assert [t["label"] for t in again["topics"]] == ["Topic 1: Page 1", "Exam notes"]
    assert uncovered(db, material["id"]) == 0


# --- Review follow-ups ---


def test_labels_collapse_newlines_tabs_and_whitespace_runs(client, student, db, project):
    material_id, ids = seed(db, student["id"], project, [[0], [1]])

    renamed = ok(rename(client, student["token"], project, ids[0], "  Cell\n\tcycle   phases \r\n"))
    added = ok(add(client, student["token"], project, material_id, "New\t\ttopic\nhere"))

    assert renamed["topics"][0]["label"] == "Cell cycle phases"
    assert added["topics"][-1]["label"] == "New topic here"
    assert [row[1] for row in saved(db, material_id)] == ["Cell cycle phases", "Topic 2", "New topic here"]


def test_add_refuses_a_101_character_label(client, student, db, project):
    material_id, _ = seed(db, student["id"], project, [[0]])

    assert_error(add(client, student["token"], project, material_id, "x" * 101), 422, "invalid_name")
    assert len(saved(db, material_id)) == 1


def test_delete_whose_heir_is_a_student_topic_with_no_sections_keeps_every_section_covered(
    client, student, db, project
):
    material_id, ids = seed(db, student["id"], project, [[0, 1]])
    added = ok(add(client, student["token"], project, material_id, "Mine"))
    student_topic = added["topics"][-1]["id"]

    # The first Topic's heir is the next one: the student Topic, which covers nothing yet.
    ok(delete(client, student["token"], project, ids[0]))

    after = saved(db, material_id)
    assert [(row[0], row[4]) for row in after] == [(student_topic, [0, 1])]
    assert uncovered(db, material_id) == 0


@pytest.mark.parametrize("which", ["valid", "one id"])
def test_merge_on_a_read_only_project_is_409(client, student, db, project, which):
    material_id, ids = seed(db, student["id"], project, [[0], [1]])
    db.execute("UPDATE projects SET archived_at = now() WHERE id = %s", (project,))
    before = saved(db, material_id)
    topic_ids = ids if which == "valid" else [ids[0], ids[0]]

    assert_error(merge(client, student["token"], project, topic_ids), 409, "project_read_only")
    assert saved(db, material_id) == before
