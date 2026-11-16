from __future__ import annotations

import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from ..models import ArtifactRecord
from ..security import safe_job_path, sha256_file, utc_now_iso


class ToolNotInstalledError(RuntimeError):
    def __init__(self, tool_name: str, install_hint: str) -> None:
        super().__init__(f"{tool_name} is not installed on this compute node. Install with: {install_hint}")
        self.tool_name = tool_name
        self.install_hint = install_hint


class JobCancelledError(RuntimeError):
    pass


@dataclass
class AdapterOutput:
    tool_version: str
    metrics: dict[str, Any] = field(default_factory=dict)
    artifacts: list[ArtifactRecord] = field(default_factory=list)


class AdapterContext:
    def __init__(
        self,
        job_id: str,
        job_dir: Path,
        cancel_event: threading.Event,
        on_log: Callable[[str], None],
        on_progress: Callable[[float, str], None],
    ) -> None:
        self.job_id = job_id
        self.job_dir = job_dir
        self.cancel_event = cancel_event
        self.on_log = on_log
        self.on_progress = on_progress
        self.artifacts: list[ArtifactRecord] = []

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise JobCancelledError("Job cancelled by user.")

    def write_input(self, relative_name: str, content: str) -> Path:
        path = safe_job_path(self.job_dir, relative_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def register_artifact(self, path: Path, fmt: str, mime_type: str = "text/plain") -> ArtifactRecord:
        resolved = safe_job_path(self.job_dir, path.name if path.parent == self.job_dir else str(path.relative_to(self.job_dir)))
        rec = ArtifactRecord(
            name=resolved.name,
            format=fmt,
            mime_type=mime_type,
            size_bytes=resolved.stat().st_size,
            sha256=sha256_file(resolved),
            created_at_utc=utc_now_iso(),
        )
        self.artifacts.append(rec)
        return rec

    def run_cmd(self, cmd: list[str], cwd: Path | None = None, timeout_sec: int = 3600) -> str:
        self.check_cancelled()
        self.on_log(f"$ {' '.join(cmd)}")
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd or self.job_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        lines: list[str] = []
        assert proc.stdout is not None
        try:
            for line in proc.stdout:
                self.check_cancelled()
                clean = line.rstrip("\r\n")
                if clean:
                    lines.append(clean)
                    self.on_log(clean)
            rc = proc.wait(timeout=timeout_sec)
        except Exception:
            proc.kill()
            raise
        if rc != 0:
            tail = "\n".join(lines[-20:])
            raise RuntimeError(f"Command failed (exit {rc}): {' '.join(cmd)}\n{tail}")
        return "\n".join(lines)


def require_binary(name: str, install_hint: str) -> str:
    exe = shutil.which(name)
    if not exe:
        raise ToolNotInstalledError(name, install_hint)
    return exe


def require_module(module_name: str, install_hint: str) -> Any:
    try:
        return __import__(module_name)
    except ImportError as exc:
        raise ToolNotInstalledError(module_name, install_hint) from exc
