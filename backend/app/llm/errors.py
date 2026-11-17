"""Gateway exceptions (AD-3). The API maps them to the error envelope in `app/errors.py`."""


class LLMError(Exception):
    """Base for every gateway error."""


class LLMOutputError(LLMError):
    """The model's reply didn't match the task's schema, also after the one retry (`llm_output_invalid`)."""


class ProviderError(LLMError):
    """The provider couldn't answer (`llm_unavailable`)."""


class ProviderRateLimited(ProviderError):
    """The provider answered 429."""


class ProviderUnavailable(ProviderError):
    """The provider answered 402/403 or another error status, timed out, or couldn't be reached."""
