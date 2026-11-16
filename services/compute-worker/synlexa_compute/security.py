from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path

SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,96}$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def generate_pairing_token() -> str:
    return secrets.token_urlsafe(32)


def verify_bearer_token(auth_header: str | None, custom_header: str | None, expected: str) -> bool:
    if not expected:
        return False
    candidate = ""
    if custom_header:
        candidate = custom_header.strip()
    elif auth_header and auth_header.lower().startswith("bearer "):
        candidate = auth_header[7:].strip()
    if not candidate:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))


def validate_safe_identifier(value: str, label: str = "identifier") -> str:
    cleaned = value.strip()
    if not SAFE_ID_RE.match(cleaned) or ".." in cleaned:
        raise ValueError(f"Unsafe {label}: {value!r}")
    return cleaned


def safe_job_path(job_dir: Path, relative_name: str) -> Path:
    if "\x00" in relative_name:
        raise ValueError("Null byte in path")
    clean_name = relative_name.strip().lstrip("/\\")
    if not clean_name or ".." in Path(clean_name).parts:
        raise ValueError(f"Path traversal rejected: {relative_name!r}")
    resolved_base = job_dir.resolve()
    resolved_target = (resolved_base / clean_name).resolve()
    if resolved_target != resolved_base and resolved_base not in resolved_target.parents:
        raise ValueError(f"Escapes job directory: {relative_name!r}")
    return resolved_target


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(65536):
            h.update(chunk)
    return h.hexdigest()
