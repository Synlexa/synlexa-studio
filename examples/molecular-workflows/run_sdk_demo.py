#!/usr/bin/env python3
"""Example workflow using the Apache-2.0 Synlexa Studio Python SDK (RUO)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bindings" / "python"))

from synlexa_sdk import SynlexaStudioClient  # noqa: E402


def main() -> None:
    studio = SynlexaStudioClient(repo_root=ROOT)

    azm = studio.analyze_smiles("CC(=O)Nc1nnc(S(N)(=O)=O)s1", name="Acetazolamide")
    print("SMILES:", azm["name"], azm["formula"], f"{azm['molecularWeight']:.3f} Da", "TPSA:", azm["tpsa"])

    rama = studio.analyze_ramachandran(ROOT / "tests/fixtures/3HS4.cif", chain_id="A")
    print(
        "Ramachandran CA2 residues:",
        rama["residueCount"],
        "secondary:",
        rama["secondaryCounts"],
        "regions:",
        rama["regionCounts"],
    )


if __name__ == "__main__":
    main()
