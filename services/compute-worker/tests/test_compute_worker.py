from __future__ import annotations

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from synlexa_compute import RUO_NOTICE
from synlexa_compute.adapters import ADAPTER_REGISTRY
from synlexa_compute.adapters.base import AdapterContext, AdapterOutput
from synlexa_compute.hardware import probe_hardware
from synlexa_compute.security import safe_job_path, sha256_bytes, verify_bearer_token
from synlexa_compute.server import ComputeEngine, make_stdlib_handler


def test_security_helpers_and_path_traversal(tmp_path: Path) -> None:
    assert verify_bearer_token("Bearer secret-123", None, "secret-123") is True
    assert verify_bearer_token(None, "secret-123", "secret-123") is True
    assert verify_bearer_token("Bearer wrong", None, "secret-123") is False

    safe = safe_job_path(tmp_path, "sub/pose.pdbqt")
    assert safe.parent.name == "sub"

    with pytest.raises(ValueError):
        safe_job_path(tmp_path, "../../etc/passwd")
    with pytest.raises(ValueError):
        safe_job_path(tmp_path, "bad\x00name.txt")


def test_hardware_probe_reports_gpl_isolation_and_tools() -> None:
    caps = probe_hardware().to_dict()
    assert caps["cpu_cores"] >= 1
    tools = {t["id"]: t for t in caps["tools"]}
    for expected in ("vina_docking", "openmm_md", "gromacs_md", "boltz_predict", "rfdiffusion_design", "pyscf_qm", "openbabel_external"):
        assert expected in tools
    assert tools["openbabel_external"]["commercial_safe"] is False
    assert tools["vina_docking"]["commercial_safe"] is True


def test_http_server_auth_job_lifecycle_and_artifacts(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def mock_adapter(ctx: AdapterContext, params: dict) -> AdapterOutput:
        ctx.on_progress(0.5, "running mock")
        ctx.on_log(f"received smiles={params.get('smiles')}")
        out = ctx.write_input("mock_pose.pdb", "ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00  0.00           C\n")
        rec = ctx.register_artifact(out, "pdb", "chemical/x-pdb")
        return AdapterOutput(tool_version="mock-1.0", metrics={"affinityKcalMol": -7.5}, artifacts=[rec])

    monkeypatch.setitem(ADAPTER_REGISTRY, "vina_docking", mock_adapter)

    engine = ComputeEngine(work_root=tmp_path)
    token = "tok-test-999"
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_stdlib_handler(engine, token))
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()

    try:
        base = f"http://127.0.0.1:{port}"
        # Health is unauthenticated
        with urllib.request.urlopen(f"{base}/v1/health") as resp:
            health = json.loads(resp.read().decode("utf-8"))
        assert health["ok"] is True
        assert health["ruoNotice"] == RUO_NOTICE

        # Capabilities requires auth
        with pytest.raises(urllib.error.HTTPError) as err_info:
            urllib.request.urlopen(f"{base}/v1/capabilities")
        assert err_info.value.code == 401

        req_caps = urllib.request.Request(
            f"{base}/v1/capabilities",
            headers={"X-Synlexa-Compute-Token": token},
        )
        with urllib.request.urlopen(req_caps) as resp:
            caps = json.loads(resp.read().decode("utf-8"))
        assert caps["ok"] is True
        assert "vina_docking" in caps["data"]["supportedAdapters"]

        # Submit job
        body = json.dumps({"toolId": "vina_docking", "params": {"smiles": "CCO"}}).encode("utf-8")
        req_sub = urllib.request.Request(
            f"{base}/v1/jobs",
            data=body,
            method="POST",
            headers={"X-Synlexa-Compute-Token": token, "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req_sub) as resp:
            assert resp.status == 202
            sub_res = json.loads(resp.read().decode("utf-8"))
        job_id = sub_res["job"]["job_id"]

        # Poll until complete
        job_data = None
        for _ in range(40):
            req_get = urllib.request.Request(
                f"{base}/v1/jobs/{job_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            with urllib.request.urlopen(req_get) as resp:
                job_data = json.loads(resp.read().decode("utf-8"))["job"]
            if job_data["status"] == "completed":
                break
            time.sleep(0.05)

        assert job_data is not None
        assert job_data["status"] == "completed"
        assert job_data["metrics"]["affinityKcalMol"] == -7.5
        assert len(job_data["artifacts"]) == 1
        art = job_data["artifacts"][0]

        # Download artifact and verify SHA-256
        req_art = urllib.request.Request(
            f"{base}/v1/jobs/{job_id}/artifacts/{art['name']}",
            headers={"X-Synlexa-Compute-Token": token},
        )
        with urllib.request.urlopen(req_art) as resp:
            art_bytes = resp.read()
        assert sha256_bytes(art_bytes) == art["sha256"]
    finally:
        httpd.shutdown()
        httpd.server_close()


def test_missing_tool_fails_cleanly_without_fabricating_metrics(tmp_path: Path) -> None:
    engine = ComputeEngine(work_root=tmp_path)
    # Call rdkit_3d / boltz_predict in minimal Mac host env without fabricating scores
    job = engine.submit_job("boltz_predict", {"sequences": [{"id": "A", "sequence": "MKT"}]})
    for _ in range(40):
        cur = engine.get_job(job.job_id)
        if cur and cur["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.05)
    cur = engine.get_job(job.job_id)
    assert cur is not None
    assert cur["status"] == "failed"
    assert cur["error_code"] in ("ERR_TOOL_NOT_INSTALLED", "ERR_EXECUTION_FAILED")
    assert cur["metrics"] == {}
