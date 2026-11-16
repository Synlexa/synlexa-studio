"""Clients for local `studio-cli` deterministic kernels and `synlexa-compute` nodes."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


class SynlexaCliError(RuntimeError):
    """Raised when `studio-cli` exits non-zero or returns malformed output."""


def _find_repo_root(start: Path) -> Path | None:
    cur = start.resolve()
    for parent in [cur, *cur.parents]:
        if (parent / "Cargo.toml").exists() and (parent / "crates" / "studio-cli").exists():
            return parent
    return None


class SynlexaStudioClient:
    """Wrapper around the deterministic `studio-cli` native executable."""

    def __init__(self, cli_path: str | Path | None = None, repo_root: str | Path | None = None) -> None:
        self.cli_path = str(cli_path) if cli_path else None
        self.repo_root = Path(repo_root) if repo_root else _find_repo_root(Path.cwd())

    def _base_command(self) -> list[str]:
        if self.cli_path:
            return [self.cli_path]
        env_bin = os.environ.get("SYNLEXA_STUDIO_CLI")
        if env_bin:
            return [env_bin]
        on_path = shutil.which("studio-cli")
        if on_path:
            return [on_path]
        if self.repo_root:
            for profile in ("release", "debug"):
                cand = self.repo_root / "target" / profile / ("studio-cli.exe" if os.name == "nt" else "studio-cli")
                if cand.exists():
                    return [str(cand)]
            if shutil.which("cargo"):
                return ["cargo", "run", "--quiet", "-p", "studio-cli", "--"]
        raise FileNotFoundError(
            "Could not locate `studio-cli` on PATH or in target/. Install Synlexa Studio or pass cli_path=..."
        )

    def _run_json(self, subcommand: str, args: list[str]) -> dict[str, Any]:
        cmd = [*self._base_command(), subcommand, *args]
        proc = subprocess.run(
            cmd,
            cwd=str(self.repo_root) if self.repo_root else None,
            text=True,
            capture_output=True,
            check=False,
        )
        if proc.returncode != 0:
            raise SynlexaCliError(proc.stderr.strip() or proc.stdout.strip() or f"Command failed: {cmd}")
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError as exc:
            raise SynlexaCliError(f"Expected JSON from studio-cli, got: {proc.stdout[:200]}") from exc

    def inspect_structure(self, path: str | Path, hint: str = "auto") -> dict[str, Any]:
        return self._run_json("inspect", ["--input", str(path), "--hint", hint])

    def compare_structures(
        self,
        ref_path: str | Path,
        mob_path: str | Path,
        *,
        ref_chain: str | None = None,
        mob_chain: str | None = None,
        pae_path: str | Path | None = None,
    ) -> dict[str, Any]:
        args = ["--ref", str(ref_path), "--mob", str(mob_path)]
        if ref_chain:
            args.extend(["--ref-chain", ref_chain])
        if mob_chain:
            args.extend(["--mob-chain", mob_chain])
        if pae_path:
            args.extend(["--pae", str(pae_path)])
        return self._run_json("compare", args)

    def analyze_peptide(
        self,
        sequence: str,
        *,
        mutations: list[str] | None = None,
        slice_start: int | None = None,
        slice_end: int | None = None,
        structure_path: str | Path | None = None,
        chain_id: str | None = None,
        focus_seq_id: int | None = None,
    ) -> dict[str, Any]:
        args = ["--seq", sequence]
        if mutations:
            args.extend(["--mut", ",".join(mutations)])
        if slice_start is not None:
            args.extend(["--slice-start", str(slice_start)])
        if slice_end is not None:
            args.extend(["--slice-end", str(slice_end)])
        if structure_path:
            args.extend(["--structure", str(structure_path)])
        if chain_id:
            args.extend(["--chain", chain_id])
        if focus_seq_id is not None:
            args.extend(["--focus", str(focus_seq_id)])
        return self._run_json("peptide", args)

    def analyze_gene(
        self,
        *,
        transcript: str | None = None,
        dna: str | None = None,
        codon: int = 1,
        edit_bp: int | None = None,
        new_base: str | None = None,
        nuclease: str | None = None,
    ) -> dict[str, Any]:
        args = ["--codon", str(codon)]
        if transcript:
            args.extend(["--transcript", transcript])
        if dna:
            args.extend(["--dna", dna])
        if edit_bp is not None:
            args.extend(["--edit-bp", str(edit_bp)])
        if new_base:
            args.extend(["--new-base", new_base])
        if nuclease:
            args.extend(["--nuclease", nuclease])
        return self._run_json("gene", args)

    def analyze_smiles(self, smiles: str, *, name: str | None = None) -> dict[str, Any]:
        args = ["--smiles", smiles]
        if name:
            args.extend(["--name", name])
        return self._run_json("smiles", args)

    def analyze_ramachandran(self, path: str | Path, *, chain_id: str | None = None) -> dict[str, Any]:
        args = ["--input", str(path)]
        if chain_id:
            args.extend(["--chain", chain_id])
        return self._run_json("ramachandran", args)


class ComputeNodeClient:
    """HTTP client for self-hosted or Google Colab `synlexa-compute` workers."""

    def __init__(self, endpoint_or_pairing_uri: str, token: str | None = None, timeout: float = 30.0) -> None:
        raw = endpoint_or_pairing_uri.strip()
        if raw.startswith("synlexa-node://"):
            raw = raw[len("synlexa-node://") :]
        if "#" in raw:
            base, frag = raw.split("#", 1)
            raw = base
            if not token and frag:
                token = frag
        self.endpoint = raw.rstrip("/")
        self.token = token or ""
        self.timeout = timeout

    def _request_bytes(
        self,
        path: str,
        *,
        method: str = "GET",
        json_body: dict[str, Any] | None = None,
        authenticated: bool = True,
    ) -> bytes:
        url = f"{self.endpoint}{path}"
        headers: dict[str, str] = {}
        if authenticated and self.token:
            headers["X-Synlexa-Compute-Token"] = self.token
        data: bytes | None = None
        if json_body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(json_body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return resp.read()

    def _request_json(
        self,
        path: str,
        *,
        method: str = "GET",
        json_body: dict[str, Any] | None = None,
        authenticated: bool = True,
    ) -> dict[str, Any]:
        raw = self._request_bytes(path, method=method, json_body=json_body, authenticated=authenticated)
        return json.loads(raw.decode("utf-8"))

    def health(self) -> dict[str, Any]:
        return self._request_json("/v1/health", authenticated=False)

    def capabilities(self) -> dict[str, Any]:
        return self._request_json("/v1/capabilities")

    def submit_job(self, tool_id: str, params: dict[str, Any]) -> dict[str, Any]:
        return self._request_json("/v1/jobs", method="POST", json_body={"toolId": tool_id, "params": params})

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._request_json(f"/v1/jobs/{urllib.parse.quote(job_id, safe='')}")

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        return self._request_json(f"/v1/jobs/{urllib.parse.quote(job_id, safe='')}/cancel", method="POST", json_body={})

    def wait_for_job(self, job_id: str, *, poll_interval: float = 1.0, max_wait: float = 300.0) -> dict[str, Any]:
        deadline = time.monotonic() + max_wait
        while True:
            res = self.get_job(job_id)
            job = res.get("job", {})
            if job.get("status") in {"completed", "failed", "cancelled"}:
                return job
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Compute job {job_id} did not finish within {max_wait}s")
            time.sleep(poll_interval)

    def download_artifact(self, job_id: str, artifact_name: str, expected_sha256: str | None = None) -> bytes:
        path = f"/v1/jobs/{urllib.parse.quote(job_id, safe='')}/artifacts/{urllib.parse.quote(artifact_name, safe='')}"
        payload = self._request_bytes(path)
        if expected_sha256:
            actual = hashlib.sha256(payload).hexdigest()
            if actual != expected_sha256:
                raise ValueError(f"Artifact SHA-256 mismatch: expected {expected_sha256}, got {actual}")
        return payload
