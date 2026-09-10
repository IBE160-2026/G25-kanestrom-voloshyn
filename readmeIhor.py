#!/usr/bin/env python3
"""
readmeIhor.py
Run me for a surprise:  python3 readmeIhor.py
"""

import colorsys
import random
import shutil
import sys
import time

RESET = "\033[0m"
BOLD = "\033[1m"


def rgb(r, g, b):
    return f"\033[38;2;{r};{g};{b}m"


def hue_color(h):
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, 0.95, 1.0)
    return rgb(int(r * 255), int(g * 255), int(b * 255))


def rainbow_line(text, offset=0.0, speed=0.045):
    out = []
    for i, ch in enumerate(text):
        if ch == " ":
            out.append(" ")
        else:
            out.append(hue_color(offset + i * speed) + ch)
    return "".join(out) + RESET


def type_out(text, delay=0.012, offset=0.0):
    for i, ch in enumerate(text):
        color = "" if ch == " " else hue_color(offset + i * 0.05)
        sys.stdout.write(color + ch + RESET)
        sys.stdout.flush()
        time.sleep(delay)
    print()


LETTERS = {
    "I": ["█████", "  █  ", "  █  ", "  █  ", "█████"],
    "H": ["█   █", "█   █", "█████", "█   █", "█   █"],
    "O": [" ███ ", "█   █", "█   █", "█   █", " ███ "],
    "R": ["████ ", "█   █", "████ ", "█  █ ", "█   █"],
}


def banner_rows(word, gap="  "):
    rows = ["" for _ in range(5)]
    for letter in word:
        glyph = LETTERS[letter]
        for r in range(5):
            rows[r] += glyph[r] + gap
    return rows


def show_banner(word="IHOR"):
    rows = banner_rows(word)
    width = shutil.get_terminal_size((80, 20)).columns
    t0 = time.time()
    for r, row in enumerate(rows):
        pad = max((width - len(row)) // 2, 0)
        offset = (time.time() - t0) * 0.6 + r * 0.08
        print(" " * pad + rainbow_line(row, offset=offset))
        time.sleep(0.05)


HYPE = [
    "★ LEGENDARY CODE INCOMING ★",
    "✦ UNSTOPPABLE ✦",
    "✧ BRILLIANT WORK ✧",
    "★ PURE GENIUS ★",
    "✦ CRUSHING IT ✦",
    "✧ TOP TIER DEVELOPER ✧",
    "★ ABSOLUTE LEGEND ★",
]

SPARKLES = ["✨", "🌈", "⭐", "💫", "🎉", "🔥", "🚀", "💎"]


def confetti_line(width):
    chars = [random.choice(SPARKLES) for _ in range(width // 3)]
    offset = random.random()
    return rainbow_line("  ".join(chars), offset=offset, speed=0.08)


def main():
    width = shutil.get_terminal_size((80, 20)).columns
    print()
    type_out("booting up something special for you...", delay=0.02)
    time.sleep(0.3)
    print()

    show_banner("IHOR")
    print()

    for i in range(3):
        print(confetti_line(min(width, 60)))
        time.sleep(0.12)
    print()

    for line in HYPE:
        pad = max((width - len(line)) // 2, 0)
        print(" " * pad + rainbow_line(line, offset=random.random()))
        time.sleep(0.15)

    print()
    for i in range(3):
        print(confetti_line(min(width, 60)))
        time.sleep(0.12)
    print()

    msg = "YOU ARE AMAZING, IHOR — KEEP BUILDING GREAT THINGS!"
    border = "═" * (len(msg) + 4)
    pad = max((width - (len(msg) + 4)) // 2, 0)
    t0 = time.time()
    print(" " * pad + rainbow_line("╔" + border + "╗", offset=t0))
    print(" " * pad + rainbow_line(f"║  {msg}  ║", offset=t0 + 0.1))
    print(" " * pad + rainbow_line("╚" + border + "╝", offset=t0 + 0.2))
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(RESET)
