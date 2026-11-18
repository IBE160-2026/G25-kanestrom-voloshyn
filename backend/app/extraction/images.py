"""Photos of notes into one JPEG for the vision model (FR-7, AD-5). Blocking; run via `normalize`.

Every accepted image (JPG, PNG, HEIC) is decoded, turned upright from its EXIF orientation, flattened
onto white, scaled so its long side is at most `MAX_SIDE` pixels, and encoded as JPEG. A file that
can't be decoded raises `Unparseable` (AD-6). Nothing here logs image bytes.
"""

import asyncio
import io

import pillow_heif
from PIL import Image, ImageOps

from app.extraction.types import Unparseable

IMAGE_TYPES = frozenset({"jpg", "png", "heic"})
MAX_SIDE = 2048
JPEG_QUALITY = 85
# Refuse decompression bombs: far above any phone photo, far below what would exhaust memory.
MAX_PIXELS = 80_000_000
# The decoder each file type must open with (JPEG also opens multi-picture JPEGs from phones). Only
# these run; bytes of another format than the extension says are unparseable (AD-6).
FORMAT_OF = {"jpg": "JPEG", "png": "PNG", "heic": "HEIF"}
FORMATS = tuple(FORMAT_OF.values())

pillow_heif.register_heif_opener()


def normalize_sync(data: bytes, file_type: str) -> bytes:
    """The image as JPEG bytes, long side at most `MAX_SIDE`. `Unparseable` when it can't be decoded."""
    if file_type not in IMAGE_TYPES:
        raise ValueError(f"Not an image type: {file_type!r}")
    try:
        with Image.open(io.BytesIO(data), formats=FORMATS) as opened:
            if opened.format != FORMAT_OF[file_type]:
                raise Unparseable("wrong content for its extension")
            # Checked before decoding; Pillow's own DecompressionBombError covers the rest.
            if opened.width * opened.height > MAX_PIXELS:
                raise Unparseable("image too large to decode")
            opened.load()
            image = ImageOps.exif_transpose(opened)
        image = _flatten(image)
        image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=JPEG_QUALITY)
        return out.getvalue()
    except Unparseable:
        raise
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise Unparseable("image can't be decoded") from None


def _flatten(image: Image.Image) -> Image.Image:
    """RGB, with any transparency put on white (a transparent PNG would otherwise turn black)."""
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


async def normalize(data: bytes, file_type: str) -> bytes:
    """`normalize_sync` off the event loop (AD-29)."""
    return await asyncio.to_thread(normalize_sync, data, file_type)
