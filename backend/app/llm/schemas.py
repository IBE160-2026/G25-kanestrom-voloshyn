"""What each typed task returns (AD-3). Live and mock output are both parsed through these models."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

PROJECT_NAME_MAX = 100


class ProjectName(BaseModel):
    """`name_project`: a short name for a Project, from its first file (FR-4)."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=PROJECT_NAME_MAX)]


TOPIC_LABEL_MAX = 100
TOPICS_MAX = 100

TopicLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TOPIC_LABEL_MAX)]


class DetectedTopic(BaseModel):
    """One Topic: a short label, an optional broader group (a chapter or part), and the 1-based
    Section numbers (`S1…Sn` in the request) it covers."""

    model_config = ConfigDict(extra="forbid")

    label: TopicLabel
    # Required but nullable, so the JSON schema stays valid in strict mode.
    group_label: TopicLabel | None
    sections: Annotated[list[Annotated[int, Field(ge=1)]], Field(min_length=1)]

    @field_validator("group_label", mode="before")
    @classmethod
    def _blank_group_is_none(cls, value: object) -> object:
        """A blank group (`""` or whitespace) means no group, not invalid output."""
        return None if isinstance(value, str) and not value.strip() else value


class DetectedTopics(BaseModel):
    """`detect_topics`: a Material's Topics, in order (FR-22, AD-21)."""

    model_config = ConfigDict(extra="forbid")

    topics: Annotated[list[DetectedTopic], Field(min_length=1, max_length=TOPICS_MAX)]


Legibility = Literal["readable", "partial", "unreadable"]


# A photo's transcription is cut to this many characters: more is never a page of notes.
IMAGE_TEXT_MAX = 20_000


class ImageText(BaseModel):
    """`extract_image_text`: the text in a photo of notes as Markdown, and how legible the photo was
    (FR-7, AD-6). `partial` when some of it couldn't be read; `unreadable` when almost none could."""

    model_config = ConfigDict(extra="forbid")

    legibility: Legibility
    text: str

    @field_validator("text")
    @classmethod
    def _cap_text(cls, value: str) -> str:
        return value[:IMAGE_TEXT_MAX]


# At most this many Quiz questions per request, server-enforced (AD-12).
QUIZ_MAX = 20
QUIZ_OPTIONS = 4


class DraftQuestion(BaseModel):
    """One multiple-choice question as the model writes it: four options with the index of the correct
    one, an explanation, and the 1-based Section numbers (`S1…Sn`) it rests on. The service shuffles
    the options and maps the numbers back to Section ids (AD-9)."""

    model_config = ConfigDict(extra="forbid")

    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # A blank or repeated option drops that question in the service's check, not the whole reply.
    options: Annotated[list[str], Field(min_length=QUIZ_OPTIONS, max_length=QUIZ_OPTIONS)]
    correct_index: Annotated[int, Field(ge=0, le=QUIZ_OPTIONS - 1)]
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # May be empty: an uncited question is dropped by the service, not retried.
    sections: list[int]


class QuizDraft(BaseModel):
    """`generate_quiz`: up to 20 questions (FR-10, AD-9). Extra questions are cut, not refused."""

    model_config = ConfigDict(extra="forbid")

    questions: Annotated[list[DraftQuestion], Field(max_length=QUIZ_MAX)]

    @field_validator("questions", mode="before")
    @classmethod
    def _cap(cls, value: object) -> object:
        return value[:QUIZ_MAX] if isinstance(value, list) else value


# At most this many flashcards per set, server-enforced (AD-12).
FLASHCARDS_MAX = 20


class DraftCard(BaseModel):
    """One flashcard as the model writes it: a question, its answer, and the 1-based Section numbers
    (`S1…Sn`) it rests on. The service maps the numbers back to Section ids (AD-7)."""

    model_config = ConfigDict(extra="forbid")

    # A blank question or answer drops that card in the service's check, not the whole reply.
    question: str
    answer: str
    # May be empty: an uncited card is dropped by the service, not retried.
    sections: list[int]


class FlashcardDraft(BaseModel):
    """`generate_flashcards`: up to 20 cards (FR-13). Extra cards are cut, not refused."""

    model_config = ConfigDict(extra="forbid")

    cards: Annotated[list[DraftCard], Field(max_length=FLASHCARDS_MAX)]

    @field_validator("cards", mode="before")
    @classmethod
    def _cap(cls, value: object) -> object:
        return value[:FLASHCARDS_MAX] if isinstance(value, list) else value


# At most this many Practice Questions per Mistake Review round (AD-11, AD-12).
PRACTICE_MAX = 20


class DraftPractice(BaseModel):
    """One practice question for one Mistake, as the model writes it (AD-9, AD-11): the target's
    `mistake_id` copied back, four options with the index of the correct one, an explanation, and the
    1-based Section numbers (`S1…Sn`) it rests on. The service shuffles the options, maps the numbers
    back to Section ids, and falls back to the original question when an item is unusable."""

    model_config = ConfigDict(extra="forbid")

    mistake_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # A blank or repeated option makes the service use the original question, not a retry.
    options: Annotated[list[str], Field(min_length=QUIZ_OPTIONS, max_length=QUIZ_OPTIONS)]
    correct_index: Annotated[int, Field(ge=0, le=QUIZ_OPTIONS - 1)]
    explanation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # May be empty: an uncited item falls back to the original question.
    sections: list[int]


class PracticeDraft(BaseModel):
    """`generate_practice`: at most one item per target, at most 20 (FR-18, AD-11). Extra items are cut."""

    model_config = ConfigDict(extra="forbid")

    items: Annotated[list[DraftPractice], Field(max_length=PRACTICE_MAX)]

    @field_validator("items", mode="before")
    @classmethod
    def _cap(cls, value: object) -> object:
        return value[:PRACTICE_MAX] if isinstance(value, list) else value
