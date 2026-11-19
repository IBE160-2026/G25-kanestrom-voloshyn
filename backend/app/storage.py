"""The private `study-materials` bucket (AD-16): the only reader and writer of stored originals.

Calls Supabase Storage over the app's one HTTP client with the secret key. Paths:
`{account_id}/{project_id}/{material_id}/original` for Materials, and
`{account_id}/{project_id}/phone/{batch_id}/{photo_id}` for staged phone photos (AD-24). Objects are deleted only after the matching DB
change commits; a failed delete is logged and swallowed. Never logs file contents or keys.
"""

import logging
from dataclasses import dataclass
from urllib.parse import quote
from uuid import UUID

import httpx2

from app import supabase_auth
from app.config import Settings

logger = logging.getLogger(__name__)

BUCKET = "study-materials"
# Storage uploads can take longer than the 5 s auth timeout of the shared client.
TIMEOUT_SECONDS = 120.0
# Page size when listing a prefix, and the most names per bulk delete.
LIST_PAGE = 1000
REMOVE_BATCH = 1000


class StorageError(Exception):
    """Storage refused or couldn't be reached."""


def material_path(account_id: UUID, project_id: UUID, material_id: UUID) -> str:
    return f"{account_id}/{project_id}/{material_id}/original"


def phone_photo_path(account_id: UUID, project_id: UUID, batch_id: UUID, photo_id: UUID) -> str:
    """Where a phone photo waits until its batch is processed or cleaned up (AD-16, AD-24)."""
    return f"{account_id}/{project_id}/phone/{batch_id}/{photo_id}"


@dataclass(frozen=True)
class Storage:
    http: httpx2.AsyncClient
    settings: Settings

    def _url(self, path: str) -> str:
        return f"/storage/v1/object/{BUCKET}/{quote(path)}"

    async def put(self, path: str, data: bytes, content_type: str) -> None:
        """Store an object; never overwrites one."""
        headers = {**supabase_auth.admin_headers(self.settings), "Content-Type": content_type, "x-upsert": "false"}
        try:
            response = await self.http.post(self._url(path), content=data, headers=headers, timeout=TIMEOUT_SECONDS)
        except httpx2.HTTPError as exc:
            raise StorageError(type(exc).__name__) from None
        if response.status_code != 200:
            raise StorageError(f"HTTP {response.status_code}")

    async def get(self, path: str) -> bytes:
        """Read an object's bytes; `StorageError` when it is missing or Storage can't be reached."""
        try:
            response = await self.http.get(
                self._url(path), headers=supabase_auth.admin_headers(self.settings), timeout=TIMEOUT_SECONDS
            )
        except httpx2.HTTPError as exc:
            raise StorageError(type(exc).__name__) from None
        if response.status_code != 200:
            raise StorageError(f"HTTP {response.status_code}")
        return response.content

    async def delete(self, path: str) -> None:
        """Delete an object, logging and swallowing any failure (a missing object is fine)."""
        try:
            response = await self.http.delete(
                self._url(path), headers=supabase_auth.admin_headers(self.settings), timeout=TIMEOUT_SECONDS
            )
        except httpx2.HTTPError as exc:
            logger.warning("Storage delete failed: %s", type(exc).__name__)
            return
        if response.status_code not in (200, 204, 400, 404):
            logger.warning("Storage answered %s to a delete", response.status_code)

    async def _list(self, prefix: str) -> list[str]:
        """Every object name under the folder `prefix` (no trailing slash), recursing into subfolders."""
        names: list[str] = []
        offset = 0
        while True:
            response = await self.http.post(
                f"/storage/v1/object/list/{BUCKET}",
                json={"prefix": prefix, "limit": LIST_PAGE, "offset": offset},
                headers=supabase_auth.admin_headers(self.settings),
                timeout=TIMEOUT_SECONDS,
            )
            if response.status_code != 200:
                raise StorageError(f"HTTP {response.status_code}")
            entries = response.json()
            for entry in entries:
                path = f"{prefix}/{entry['name']}"
                # Folders have no id.
                if entry.get("id") is None:
                    names += await self._list(path)
                else:
                    names.append(path)
            if len(entries) < LIST_PAGE:
                return names
            offset += LIST_PAGE

    async def delete_prefix(self, prefix: str) -> None:
        """Delete every object under `prefix` (a Project's `{account_id}/{project_id}/`, FR-24), logging and
        swallowing any failure, like `delete`."""
        try:
            names = await self._list(prefix.rstrip("/"))
            for start in range(0, len(names), REMOVE_BATCH):
                response = await self.http.request(
                    "DELETE",
                    f"/storage/v1/object/{BUCKET}",
                    json={"prefixes": names[start : start + REMOVE_BATCH]},
                    headers=supabase_auth.admin_headers(self.settings),
                    timeout=TIMEOUT_SECONDS,
                )
                if response.status_code not in (200, 204):
                    logger.warning("Storage answered %s to a bulk delete", response.status_code)
        except Exception as exc:  # noqa: BLE001 -- runs after the commit; never turns a done purge into an error
            logger.warning("Storage prefix delete failed: %s", type(exc).__name__)
