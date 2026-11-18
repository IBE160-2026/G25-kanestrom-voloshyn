"""LLM gateway (AD-3, AD-4). The only package allowed to import `openai`.

`Gateway` is created once in the app lifespan (`app.state.llm`); its typed tasks return models from
`schemas.py` and raise the exceptions in `errors.py`.
"""

from app.llm.errors import LLMError, LLMOutputError, ProviderError, ProviderRateLimited, ProviderUnavailable
from app.llm.gateway import Gateway, create_gateway
from app.llm.schemas import DetectedTopic, DetectedTopics, ImageText, ProjectName

__all__ = [
    "DetectedTopic",
    "DetectedTopics",
    "Gateway",
    "ImageText",
    "LLMError",
    "LLMOutputError",
    "ProjectName",
    "ProviderError",
    "ProviderRateLimited",
    "ProviderUnavailable",
    "create_gateway",
]
