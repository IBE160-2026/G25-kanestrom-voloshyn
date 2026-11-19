"""Multiple-choice helpers shared by Quiz questions and Practice Questions (AD-9). Pure and synchronous
(AD-29): no I/O here.

- `usable_options`: four options, none blank, no two alike (ignoring case and surrounding space).
- `shuffle`: the options shuffled into ids `a`-`d`, with the correct one's id.
- `section_ids`: the cited Section ids of several rows, in first-seen order.
- `shown`: a stored question as the student sees it, with the answer key only once answered.
"""

import random
from collections.abc import Sequence
from typing import Any
from uuid import UUID

OPTION_IDS = ("a", "b", "c", "d")


def usable_options(options: Sequence[str]) -> bool:
    normalized = {option.strip().casefold() for option in options}
    return len(options) == len(OPTION_IDS) and "" not in normalized and len(normalized) == len(options)


def shuffle(options: Sequence[str], correct_index: int, rng: random.Random) -> tuple[list[dict[str, str]], str]:
    """`([{id, text}] in ids a-d, correct_option_id)`, shuffled so the correct answer lands anywhere."""
    order = list(range(len(options)))
    rng.shuffle(order)
    shuffled = [
        {"id": option_id, "text": options[original]} for option_id, original in zip(OPTION_IDS, order, strict=True)
    ]
    return shuffled, OPTION_IDS[order.index(correct_index)]


def section_ids(rows: Sequence[dict[str, Any]]) -> list[UUID]:
    return list(dict.fromkeys(section_id for row in rows for section_id in row["source_section_ids"]))


def shown(row: dict[str, Any], stored: dict[str, Any] | None, labels: dict[UUID, str]) -> dict[str, Any]:
    """`{id, position, question, options, answer}`: `answer` is null until answered, so the answer key,
    explanation, and sources never reach the browser before (AD-9)."""
    result: dict[str, Any] = {
        "id": row["id"],
        "position": row["position"],
        "question": row["question"],
        "options": [{"id": option["id"], "text": option["text"]} for option in row["options"]],
        "answer": None,
    }
    if stored is not None:
        names = dict.fromkeys(labels[s] for s in row["source_section_ids"] if s in labels)
        result["answer"] = {
            "submitted_option_id": stored["submitted_option_id"],
            "is_correct": stored["is_correct"],
            "correct_option_id": row["correct_option_id"],
            "explanation": row["explanation"],
            "sources": [{"label": label} for label in names],
        }
    return result
