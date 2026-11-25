"""LLM gateway (AD-3, AD-4). The only package allowed to import `openai`.

`Gateway` is created once in the app lifespan (`app.state.llm`); its typed tasks return models from
`schemas.py` and raise the exceptions in `errors.py`.
"""

from app.llm.errors import LLMError, LLMOutputError, ProviderError, ProviderRateLimited, ProviderUnavailable
from app.llm.gateway import Gateway, PracticeTarget, create_gateway, practice_sections
from app.llm.schemas import (
    DetectedTopic,
    DetectedTopics,
    DraftCard,
    DraftPractice,
    DraftQuestion,
    DraftSummarySection,
    FlashcardDraft,
    ImageText,
    PracticeDraft,
    ProjectName,
    QuizDraft,
    SummaryDraft,
)

__all__ = [
    "DetectedTopic",
    "DetectedTopics",
    "DraftCard",
    "DraftPractice",
    "DraftQuestion",
    "DraftSummarySection",
    "FlashcardDraft",
    "Gateway",
    "ImageText",
    "LLMError",
    "LLMOutputError",
    "PracticeDraft",
    "PracticeTarget",
    "ProjectName",
    "ProviderError",
    "ProviderRateLimited",
    "ProviderUnavailable",
    "QuizDraft",
    "SummaryDraft",
    "create_gateway",
    "practice_sections",
]
