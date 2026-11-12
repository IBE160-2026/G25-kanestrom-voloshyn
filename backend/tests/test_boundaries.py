"""Only app/llm/ may import openai (AD-3)."""

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"
LLM_DIR = APP_DIR / "llm"


def imports_openai(source: str) -> bool:
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            if any(alias.name.split(".")[0] == "openai" for alias in node.names):
                return True
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            if node.module.split(".")[0] == "openai":
                return True
    return False


def test_scanner_detects_openai_imports():
    assert imports_openai("import openai")
    assert imports_openai("from openai import AsyncOpenAI")
    assert imports_openai("import openai.types as t")
    assert not imports_openai("import openai_like")
    assert not imports_openai("from .openai import x")


def test_no_openai_import_outside_llm_package():
    offenders = [
        str(path.relative_to(APP_DIR))
        for path in APP_DIR.rglob("*.py")
        if LLM_DIR not in path.parents and imports_openai(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []
