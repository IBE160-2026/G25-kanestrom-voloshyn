"""Inline citation labels in a streamed chat answer (AD-25).

The model cites Sections inline as `[S3]` (or `[S2, S5]`). `LabelStripper` takes the raw deltas as they
arrive and returns the text to forward with every complete label, and the one space or tab before it, removed.
A fragment at the end of a chunk that may still become a label (`[`, `[S`, `[S12`, `[S1, S`, or a
trailing space) is held back until the next chunk shows whether it closes. The numbers of the labels
seen are collected in first-seen order; the caller maps them to Section ids and drops unknown ones.
"""

import re

# A complete label: `[S3]`, `[S2, S5]`, `[S2,S5]`, with the one space or tab before it (never a line
# break, so lines and paragraphs stay apart).
_LABEL = re.compile(r"[ \t]?\[S\d+(?:\s*,\s*S\d+)*\]")
_NUMBER = re.compile(r"S(\d+)")
# What may still become a label (or the space before one) at the very end of the text so far.
_PARTIAL = re.compile(r"(?:[ \t]?\[(?:S(?:\d+(?:\s*,\s*(?:S\d*)?)*)?)?|[ \t])$")


class LabelStripper:
    def __init__(self) -> None:
        self._pending = ""
        self.numbers: list[int] = []

    def _strip(self, text: str) -> str:
        def drop(match: re.Match[str]) -> str:
            for number in _NUMBER.findall(match.group(0)):
                value = int(number)
                if value not in self.numbers:
                    self.numbers.append(value)
            return ""

        return _LABEL.sub(drop, text)

    def feed(self, chunk: str) -> str:
        """The text that is safe to forward now (may be empty)."""
        text = self._pending + chunk
        held = _PARTIAL.search(text)
        cut = held.start() if held else len(text)
        self._pending = text[cut:]
        return self._strip(text[:cut])

    def flush(self) -> str:
        """The rest at the end of the stream: a fragment that never closed is ordinary text."""
        text, self._pending = self._pending, ""
        return self._strip(text)
