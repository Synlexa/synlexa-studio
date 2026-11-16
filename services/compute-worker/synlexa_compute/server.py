from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from . import RUO_NOTICE, __version__
from .adapters import ADAPTER_REGISTRY
from .adapters.base import AdapterContext, JobCancelledError, ToolNotInstalledError
from .hardware import probe_hardware
from .models import JobRecord
from .security import (
    generate_pairing_token,
    safe_job_path,
    utc_now_iso,
    validate_safe_identifier,
    verify_bearer_token,
)

MAX_REQUEST_BYTES = 64 * 1024 * 1024


class ComputeEngine:
    """Thread-safe job orchestrator with per-job sandboxed working directories."""

    def __init__(self, work_root: Path | None = None, max_workers: int = 2) -> None:
        self.work_root = (work_root or Path(tempfile.mkdtemp(prefix="synlexa-compute-"))).resolve()
        self.work_root.mkdir(parents=True, exist_ok=True)
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="synlexa-job")
        self._lock = threading.Lock()
        self._jobs: dict[str, JobRecord] = {}
        self._cancels: dict[str, threading.Event] = {}

    def capabilities(self) -> dict[str, Any]:
        caps = probe_hardware().to_dict()
        caps["workerVersion"] = __version__
        caps["ruoNotice"] = RUO_NOTICE
        caps["supportedAdapters"] = sorted(ADAPTER_REGISTRY.keys())
        return caps

    def submit_job(self, tool_id: str, params: dict[str, Any]) -> JobRecord:
        if tool_id not in ADAPTER_REGISTRY:
            raise ValueError(f"Unsupported adapter tool_id: {tool_id!r}")
        job_id = f"job-{uuid.uuid4().hex[:12]}"
        job_dir = safe_job_path(self.work_root, job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        cancel_ev = threading.Event()
        rec = JobRecord(
            job_id=job_id,
            tool_id=tool_id,
            status="queued",
            created_at_utc=utc_now_iso(),
            ruo_notice=RUO_NOTICE,
        )
        with self._lock:
            self._jobs[job_id] = rec
            self._cancels[job_id] = cancel_ev
        self._executor.submit(self._run_job, job_id, tool_id, dict(params), job_dir, cancel_ev)
        return rec

    def _run_job(
        self,
        job_id: str,
        tool_id: str,
        params: dict[str, Any],
        job_dir: Path,
        cancel_ev: threading.Event,
    ) -> None:
        with self._lock:
            rec = self._jobs[job_id]
            if cancel_ev.is_set():
                rec.status = "cancelled"
                rec.finished_at_utc = utc_now_iso()
                rec.stage = "cancelled"
                return
            rec.status = "running"
            rec.started_at_utc = utc_now_iso()
            rec.stage = "initializing"
            rec.progress = 0.05

        def on_log(line: str) -> None:
            with self._lock:
                r = self._jobs[job_id]
                r.logs.append(line)
                if len(r.logs) > 500:
                    r.logs = r.logs[-500:]

        def on_progress(pct: float, stage: str) -> None:
            with self._lock:
                r = self._jobs[job_id]
                r.progress = max(0.0, min(1.0, pct))
                r.stage = stage

        ctx = AdapterContext(job_id=job_id, job_dir=job_dir, cancel_event=cancel_ev, on_log=on_log, on_progress=on_progress)
        try:
            adapter = ADAPTER_REGISTRY[tool_id]
            out = adapter(ctx, params)
            with self._lock:
                rec = self._jobs[job_id]
                rec.status = "completed"
                rec.finished_at_utc = utc_now_iso()
                rec.progress = 1.0
                rec.stage = "completed"
                rec.tool_version = out.tool_version
                rec.metrics = out.metrics
                rec.artifacts = out.artifacts
        except JobCancelledError as exc:
            with self._lock:
                rec = self._jobs[job_id]
                rec.status = "cancelled"
                rec.finished_at_utc = utc_now_iso()
                rec.stage = "cancelled"
                rec.error_code = "ERR_CANCELLED"
                rec.error_message = str(exc)
        except ToolNotInstalledError as exc:
            with self._lock:
                rec = self._jobs[job_id]
                rec.status = "failed"
                rec.finished_at_utc = utc_now_iso()
                rec.stage = "missing-tool"
                rec.error_code = "ERR_TOOL_NOT_INSTALLED"
                rec.error_message = str(exc)
        except Exception as exc:
            with self._lock:
                rec = self._jobs[job_id]
                rec.status = "failed"
                rec.finished_at_utc = utc_now_iso()
                rec.stage = "failed"
                rec.error_code = "ERR_EXECUTION_FAILED"
                rec.error_message = str(exc)

    def list_jobs(self) -> list[dict[str, Any]]:
        with self._lock:
            return [j.to_dict() for j in sorted(self._jobs.values(), key=lambda x: x.created_at_utc, reverse=True)]

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        clean_id = validate_safe_identifier(job_id, "job_id")
        with self._lock:
            j = self._jobs.get(clean_id)
            return j.to_dict() if j else None

    def cancel_job(self, job_id: str) -> dict[str, Any] | None:
        clean_id = validate_safe_identifier(job_id, "job_id")
        with self._lock:
            ev = self._cancels.get(clean_id)
            rec = self._jobs.get(clean_id)
            if not ev or not rec:
                return None
            ev.set()
            if rec.status == "queued":
                rec.status = "cancelled"
                rec.finished_at_utc = utc_now_iso()
                rec.stage = "cancelled"
            return rec.to_dict()

    def read_artifact(self, job_id: str, name: str) -> tuple[bytes, str]:
        clean_id = validate_safe_identifier(job_id, "job_id")
        job_dir = safe_job_path(self.work_root, clean_id)
        target = safe_job_path(job_dir, name)
        if not target.is_file():
            raise FileNotFoundError(f"Artifact {name!r} not found for {clean_id}")
        with self._lock:
            rec = self._jobs.get(clean_id)
            mime = "application/octet-stream"
            if rec:
                for a in rec.artifacts:
                    if a.name == target.name:
                        mime = a.mime_type
                        break
        return target.read_bytes(), mime


def make_stdlib_handler(engine: ComputeEngine, token: str):
    class SynlexaComputeHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:
            # Suppress noisy default stderr logs; avoid leaking headers.
            return

        def _send_cors_headers(self) -> None:
            origin = self.headers.get("Origin") or "*"
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Synlexa-Compute-Token")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

        def _send_json(self, code: int, payload: Any) -> None:
            raw = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _authorize(self) -> bool:
            ok = verify_bearer_token(
                self.headers.get("Authorization"),
                self.headers.get("X-Synlexa-Compute-Token"),
                token,
            )
            if not ok:
                self._send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Invalid or missing compute token."})
            return ok

        def do_OPTIONS(self) -> None:
            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self) -> None:
            path = urlparse(self.path).path.rstrip("/") or "/"
            if path == "/v1/health":
                self._send_json(
                    HTTPStatus.OK,
                    {
                        "ok": True,
                        "service": "synlexa-compute",
                        "version": __version__,
                        "ruoNotice": RUO_NOTICE,
                        "timestampUtc": utc_now_iso(),
                    },
                )
                return

            if not self._authorize():
                return

            if path == "/v1/capabilities":
                self._send_json(HTTPStatus.OK, {"ok": True, "data": engine.capabilities()})
                return
            if path == "/v1/jobs":
                self._send_json(HTTPStatus.OK, {"ok": True, "jobs": engine.list_jobs()})
                return

            m_job = re.fullmatch(r"/v1/jobs/([^/]+)", path)
            if m_job:
                try:
                    job = engine.get_job(m_job.group(1))
                    if not job:
                        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Job not found"})
                        return
                    self._send_json(HTTPStatus.OK, {"ok": True, "job": job})
                except ValueError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return

            m_art = re.fullmatch(r"/v1/jobs/([^/]+)/artifacts/([^/]+)", path)
            if m_art:
                try:
                    data, mime = engine.read_artifact(m_art.group(1), m_art.group(2))
                    self.send_response(HTTPStatus.OK)
                    self._send_cors_headers()
                    self.send_header("Content-Type", mime)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except FileNotFoundError as exc:
                    self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": str(exc)})
                except ValueError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": f"Unknown route: {path}"})

        def do_POST(self) -> None:
            path = urlparse(self.path).path.rstrip("/") or "/"
            if not self._authorize():
                return

            if path == "/v1/jobs":
                try:
                    length = int(self.headers.get("Content-Length") or "0")
                    if length <= 0 or length > MAX_REQUEST_BYTES:
                        raise ValueError("Invalid or oversized request body.")
                    raw = self.rfile.read(length)
                    body = json.loads(raw.decode("utf-8"))
                    tool_id = str(body.get("toolId") or body.get("tool_id") or "")
                    params = body.get("params") or {}
                    if not isinstance(params, dict):
                        raise ValueError("'params' must be a JSON object.")
                    job = engine.submit_job(tool_id, params)
                    self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "job": job.to_dict()})
                except ValueError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return

            m_cancel = re.fullmatch(r"/v1/jobs/([^/]+)/cancel", path)
            if m_cancel:
                try:
                    job = engine.cancel_job(m_cancel.group(1))
                    if not job:
                        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Job not found"})
                        return
                    self._send_json(HTTPStatus.OK, {"ok": True, "job": job})
                except ValueError as exc:
                    self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})
                return

            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": f"Unknown route: {path}"})

    return SynlexaComputeHandler


def _maybe_start_cloudflared_tunnel(port: int) -> tuple[subprocess.Popen[str] | None, str | None]:
    exe = shutil.which("cloudflared")
    if not exe:
        return None, None
    proc = subprocess.Popen(
        [exe, "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    assert proc.stdout is not None
    public_url = None
    for _ in range(80):
        line = proc.stdout.readline()
        if not line:
            break
        m = re.search(r"https://[a-zA-Z0-9.-]+\.trycloudflare\.com", line)
        if m:
            public_url = m.group(0)
            break
    return proc, public_url


def main() -> None:
    parser = argparse.ArgumentParser(description="Synlexa Studio External Compute Worker (RUO)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4180)
    parser.add_argument("--work-dir", default=None)
    parser.add_argument("--tunnel", action="store_true", help="Expose via Cloudflare Quick Tunnel (cloudflared)")
    args = parser.parse_args()

    token = os.environ.get("SYNLEXA_COMPUTE_TOKEN") or generate_pairing_token()
    engine = ComputeEngine(work_root=Path(args.work_dir) if args.work_dir else None)
    server = ThreadingHTTPServer((args.host, args.port), make_stdlib_handler(engine, token))

    tunnel_proc = None
    endpoint = f"http://{args.host}:{args.port}"
    if args.tunnel:
        tunnel_proc, public_url = _maybe_start_cloudflared_tunnel(args.port)
        if public_url:
            endpoint = public_url

    print("============================================================")
    print("Synlexa Compute Worker ready (Research-Use-Only)")
    print(f"Endpoint: {endpoint}")
    print(f"Pairing String (paste into Studio -> Compute Nodes):")
    print(f"synlexa-node://{endpoint}#{token}")
    print("============================================================", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if tunnel_proc is not None:
            tunnel_proc.terminate()


if __name__ == "__main__":
    main()
