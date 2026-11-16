from __future__ import annotations

import hashlib
import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SDK_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SDK_ROOT.parents[1]
if str(SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(SDK_ROOT))

from synlexa_sdk import ComputeNodeClient, RUO_NOTICE, SynlexaStudioClient  # noqa: E402


class TestSynlexaPythonSdk(unittest.TestCase):
    def test_pairing_uri_parsing_and_compute_client(self) -> None:
        artifact = b"REMARK VINA -8.4\n"
        artifact_sha = hashlib.sha256(artifact).hexdigest()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: object) -> None:
                return

            def do_GET(self) -> None:
                if self.path == "/v1/health":
                    body = json.dumps({"ok": True, "service": "synlexa-compute"}).encode("utf-8")
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if self.headers.get("X-Synlexa-Compute-Token") != "tok-py-sdk":
                    self.send_response(401)
                    self.end_headers()
                    return
                if self.path == "/v1/jobs/job-1/artifacts/pose.pdbqt":
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(artifact)
                    return
                self.send_response(404)
                self.end_headers()

        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            client = ComputeNodeClient(f"synlexa-node://http://127.0.0.1:{port}#tok-py-sdk")
            self.assertEqual(client.endpoint, f"http://127.0.0.1:{port}")
            self.assertEqual(client.token, "tok-py-sdk")
            self.assertTrue(client.health()["ok"])
            data = client.download_artifact("job-1", "pose.pdbqt", expected_sha256=artifact_sha)
            self.assertEqual(data, artifact)
            with self.assertRaises(ValueError):
                client.download_artifact("job-1", "pose.pdbqt", expected_sha256="0" * 64)
        finally:
            srv.shutdown()
            srv.server_close()

    def test_local_studio_cli_smiles_and_structure_compare(self) -> None:
        studio = SynlexaStudioClient(repo_root=REPO_ROOT)
        azm = studio.analyze_smiles("CC(=O)Nc1nnc(S(N)(=O)=O)s1", name="Acetazolamide")
        self.assertEqual(azm["formula"], "C4H6N4O3S2")
        self.assertIn("Research-Use-Only", azm["ruoNotice"])

        cmp_res = studio.compare_structures(
            REPO_ROOT / "tests/fixtures/3HS4.cif",
            REPO_ROOT / "tests/fixtures/AF-P00918-F1-model_v6.cif",
            ref_chain="A",
            mob_chain="A",
            pae_path=REPO_ROOT / "tests/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json",
        )
        self.assertEqual(cmp_res["metrics"]["matchedCaCount"], 257)
        self.assertAlmostEqual(cmp_res["metrics"]["rmsdAngstrom"], 0.368394, places=5)
        self.assertTrue(RUO_NOTICE.startswith("Research-Use-Only"))


if __name__ == "__main__":
    unittest.main()
