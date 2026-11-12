"""Tests always run in mock mode with no paid key (AD-4)."""

import os

os.environ["LLM_MODE"] = "mock"
os.environ.pop("OPENROUTER_API_KEY", None)
