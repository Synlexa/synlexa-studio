from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from .base import AdapterContext, AdapterOutput, ToolNotInstalledError, require_binary, require_module


def _smiles_to_xyz(smiles: str) -> tuple[str, list[tuple[str, float, float, float]]]:
    Chem = require_module("rdkit.Chem", "pip install rdkit")
    AllChem = require_module("rdkit.Chem.AllChem", "pip install rdkit")
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"Invalid SMILES: {smiles!r}")
    mol_h = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    cid = AllChem.EmbedMolecule(mol_h, params)
    if cid < 0:
        raise RuntimeError("RDKit ETKDGv3 conformer embedding failed.")
    AllChem.MMFFOptimizeMolecule(mol_h, maxIters=200)
    conf = mol_h.GetConformer(0)
    atoms: list[tuple[str, float, float, float]] = []
    lines = [str(mol_h.GetNumAtoms()), f"Synlexa RDKit ETKDGv3 {smiles}"]
    for idx, atom in enumerate(mol_h.GetAtoms()):
        pos = conf.GetAtomPosition(idx)
        sym = atom.GetSymbol()
        atoms.append((sym, pos.x, pos.y, pos.z))
        lines.append(f"{sym:2s} {pos.x:12.6f} {pos.y:12.6f} {pos.z:12.6f}")
    return "\n".join(lines), atoms


def run_rdkit_3d(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    Chem = require_module("rdkit.Chem", "pip install rdkit")
    AllChem = require_module("rdkit.Chem.AllChem", "pip install rdkit")
    rdkit_pkg = require_module("rdkit", "pip install rdkit")

    smiles = str(params.get("smiles") or "").strip()
    if not smiles:
        raise ValueError("Missing required parameter 'smiles'.")
    num_confs = max(1, min(25, int(params.get("numConfs", 5))))
    name = str(params.get("name") or "ligand").strip()

    ctx.on_progress(0.2, "Embedding 3D conformers (ETKDGv3)")
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError("Invalid SMILES string.")
    mol_h = Chem.AddHs(mol)
    embed_params = AllChem.ETKDGv3()
    embed_params.randomSeed = 42
    conf_ids = list(AllChem.EmbedMultipleConfs(mol_h, numConfs=num_confs, params=embed_params))
    if not conf_ids:
        raise RuntimeError("ETKDGv3 failed to generate 3D conformers.")

    ctx.on_progress(0.65, "Minimizing conformers (MMFF94)")
    energies: list[dict[str, Any]] = []
    out_sdf = ctx.job_dir / "conformers_3d.sdf"
    writer = Chem.SDWriter(str(out_sdf))
    for cid in conf_ids:
        props = AllChem.MMFFGetMoleculeProperties(mol_h)
        energy = None
        if props is not None:
            ff = AllChem.MMFFGetMoleculeForceField(mol_h, props, confId=cid)
            if ff is not None:
                ff.Minimize(maxIts=300)
                energy = round(float(ff.CalcEnergy()), 4)
        mol_h.SetProp("_Name", f"{name}_conf{cid}")
        if energy is not None:
            mol_h.SetProp("MMFF94_Energy_kcal_mol", str(energy))
        writer.write(mol_h, confId=cid)
        energies.append({"conformerId": int(cid), "mmff94EnergyKcalMol": energy})
    writer.close()

    rec = ctx.register_artifact(out_sdf, "sdf", "chemical/x-mdl-sdfile")
    return AdapterOutput(
        tool_version=f"rdkit-{getattr(rdkit_pkg, '__version__', 'unknown')}",
        metrics={
            "conformerCount": len(conf_ids),
            "conformers": energies,
            "canonicalSmiles": Chem.MolToSmiles(mol),
        },
        artifacts=[rec],
    )


def run_vina_docking(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    vina_bin = shutil.which("vina") or shutil.which("smina")
    has_vina_py = False
    if not vina_bin:
        try:
            __import__("vina")
            has_vina_py = True
        except ImportError:
            pass
    if not vina_bin and not has_vina_py:
        raise ToolNotInstalledError(
            "AutoDock Vina / Smina",
            "pip install vina meeko rdkit  # or conda install -c conda-forge autodock-vina",
        )

    receptor_pdb = str(params.get("receptorPdb") or "").strip()
    receptor_pdbqt = str(params.get("receptorPdbqt") or "").strip()
    ligand_pdbqt = str(params.get("ligandPdbqt") or "").strip()
    ligand_smiles = str(params.get("ligandSmiles") or "").strip()

    center = params.get("center") or [0.0, 0.0, 0.0]
    size = params.get("size") or [22.0, 22.0, 22.0]
    exhaustiveness = max(1, min(32, int(params.get("exhaustiveness", 8))))
    num_modes = max(1, min(20, int(params.get("numModes", 9))))

    if not receptor_pdbqt and not receptor_pdb:
        raise ValueError("Provide either 'receptorPdbqt' or 'receptorPdb'.")
    if not ligand_pdbqt and not ligand_smiles:
        raise ValueError("Provide either 'ligandPdbqt' or 'ligandSmiles'.")

    ctx.on_progress(0.15, "Preparing docking inputs")
    rec_path = ctx.job_dir / "receptor.pdbqt"
    lig_path = ctx.job_dir / "ligand.pdbqt"

    if receptor_pdbqt:
        ctx.write_input("receptor.pdbqt", receptor_pdbqt)
    else:
        raw_rec = ctx.write_input("receptor_raw.pdb", receptor_pdb)
        obabel = shutil.which("obabel")
        if obabel:
            ctx.run_cmd([obabel, str(raw_rec), "-xr", "-O", str(rec_path)])
        else:
            # Strip water/altlocs and write clean ATOM lines if pure receptor PDBQT converter absent.
            raise ToolNotInstalledError(
                "Receptor PDBQT prep (meeko/obabel)",
                "Supply 'receptorPdbqt' directly or install Open Babel / Meeko",
            )

    if ligand_pdbqt:
        ctx.write_input("ligand.pdbqt", ligand_pdbqt)
    else:
        Chem = require_module("rdkit.Chem", "pip install rdkit meeko")
        AllChem = require_module("rdkit.Chem.AllChem", "pip install rdkit meeko")
        meeko = require_module("meeko", "pip install meeko")
        mol = Chem.MolFromSmiles(ligand_smiles)
        if mol is None:
            raise ValueError("Invalid ligand SMILES.")
        mol_h = Chem.AddHs(mol)
        AllChem.EmbedMolecule(mol_h, AllChem.ETKDGv3())
        AllChem.MMFFOptimizeMolecule(mol_h)
        prep = meeko.MoleculePreparation()
        mol_setups = prep.prepare(mol_h)
        pdbqt_str, is_ok, err_msg = meeko.PDBQTWriterLegacy.write_string(mol_setups[0])
        if not is_ok:
            raise RuntimeError(f"Meeko PDBQT prep failed: {err_msg}")
        ctx.write_input("ligand.pdbqt", pdbqt_str)

    out_pdbqt = ctx.job_dir / "docked_poses.pdbqt"
    ctx.on_progress(0.45, f"Running docking ({len(center)}-axis box, exhaustiveness={exhaustiveness})")

    poses: list[dict[str, Any]] = []
    tool_ver = "vina"
    if has_vina_py:
        vina_mod = __import__("vina")
        tool_ver = f"vina-py-{getattr(vina_mod, '__version__', '1.x')}"
        v = vina_mod.Vina(sf_name="vina")
        v.set_receptor(str(rec_path))
        v.set_ligand_from_file(str(lig_path))
        v.compute_vina_maps(center=[float(x) for x in center], box_size=[float(x) for x in size])
        v.dock(exhaustiveness=exhaustiveness, n_poses=num_modes)
        v.write_poses(str(out_pdbqt), n_poses=num_modes, overwrite=True)
        energies = v.energies(n_poses=num_modes)
        for i, row in enumerate(energies):
            poses.append(
                {
                    "mode": i + 1,
                    "affinityKcalMol": round(float(row[0]), 3),
                    "rmsdLowerBound": round(float(row[1]), 3),
                    "rmsdUpperBound": round(float(row[2]), 3),
                }
            )
    else:
        assert vina_bin is not None
        tool_ver = Path(vina_bin).name
        stdout = ctx.run_cmd(
            [
                vina_bin,
                "--receptor",
                str(rec_path),
                "--ligand",
                str(lig_path),
                "--center_x",
                str(center[0]),
                "--center_y",
                str(center[1]),
                "--center_z",
                str(center[2]),
                "--size_x",
                str(size[0]),
                "--size_y",
                str(size[1]),
                "--size_z",
                str(size[2]),
                "--exhaustiveness",
                str(exhaustiveness),
                "--num_modes",
                str(num_modes),
                "--out",
                str(out_pdbqt),
            ]
        )
        for m in re.finditer(r"^\s*(\d+)\s+(-?\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)", stdout, re.MULTILINE):
            poses.append(
                {
                    "mode": int(m.group(1)),
                    "affinityKcalMol": float(m.group(2)),
                    "rmsdLowerBound": float(m.group(3)),
                    "rmsdUpperBound": float(m.group(4)),
                }
            )

    rec = ctx.register_artifact(out_pdbqt, "pdbqt", "chemical/x-pdbqt")
    return AdapterOutput(
        tool_version=tool_ver,
        metrics={
            "engine": tool_ver,
            "center": center,
            "size": size,
            "exhaustiveness": exhaustiveness,
            "poses": poses,
            "bestAffinityKcalMol": poses[0]["affinityKcalMol"] if poses else None,
        },
        artifacts=[rec],
    )


def run_pyscf_qm(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    pyscf = require_module("pyscf", "pip install pyscf")
    gto = require_module("pyscf.gto", "pip install pyscf")
    scf = require_module("pyscf.scf", "pip install pyscf")
    dft = require_module("pyscf.dft", "pip install pyscf")

    smiles = str(params.get("smiles") or "").strip()
    xyz_input = str(params.get("xyz") or "").strip()
    basis = str(params.get("basis") or "sto-3g").strip()
    functional = str(params.get("functional") or "B3LYP").strip()
    charge = int(params.get("charge", 0))
    spin = int(params.get("spin", 0))

    if not xyz_input:
        if not smiles:
            raise ValueError("Provide either 'xyz' coordinates or 'smiles'.")
        ctx.on_progress(0.15, "Generating 3D geometry via RDKit ETKDGv3")
        xyz_str, atoms = _smiles_to_xyz(smiles)
        ctx.write_input("input.xyz", xyz_str)
        atom_spec = "; ".join(f"{s} {x:.6f} {y:.6f} {z:.6f}" for s, x, y, z in atoms)
    else:
        lines = [ln.strip() for ln in xyz_input.splitlines() if ln.strip()]
        # Support either raw XYZ with 2-line header or bare "Elem x y z" lines.
        if lines and lines[0].isdigit() and len(lines) >= 3:
            lines = lines[2:]
        atom_spec = "; ".join(lines)

    ctx.on_progress(0.45, f"Running PySCF {functional}/{basis}")
    mol = gto.M(atom=atom_spec, basis=basis, charge=charge, spin=spin, verbose=0)
    if functional.upper() == "HF":
        mf = scf.RHF(mol)
    else:
        mf = dft.RKS(mol)
        mf.xc = functional
    energy_ha = float(mf.kernel())
    if not mf.converged:
        ctx.on_log("Warning: SCF did not fully converge within default cycles.")

    mo_e = mf.mo_energy
    mo_occ = mf.mo_occ
    occ_idx = [i for i, o in enumerate(mo_occ) if o > 0]
    virt_idx = [i for i, o in enumerate(mo_occ) if o == 0]
    hartree_to_ev = 27.211386245988
    homo_ev = round(float(mo_e[occ_idx[-1]] * hartree_to_ev), 4) if occ_idx else None
    lumo_ev = round(float(mo_e[virt_idx[0]] * hartree_to_ev), 4) if virt_idx else None
    gap_ev = round(lumo_ev - homo_ev, 4) if (homo_ev is not None and lumo_ev is not None) else None

    dipole = mf.dip_moment(unit="Debye", verbose=0)
    dipole_norm = round(float((dipole[0] ** 2 + dipole[1] ** 2 + dipole[2] ** 2) ** 0.5), 4)

    summary_path = ctx.write_input(
        "pyscf_summary.json",
        f'{{"totalEnergyHartree": {energy_ha:.8f}, "homoEv": {homo_ev}, "lumoEv": {lumo_ev}, "gapEv": {gap_ev}, "dipoleDebye": {dipole_norm}}}',
    )
    rec = ctx.register_artifact(summary_path, "json", "application/json")

    return AdapterOutput(
        tool_version=f"pyscf-{getattr(pyscf, '__version__', 'unknown')}",
        metrics={
            "method": f"{functional}/{basis}",
            "converged": bool(mf.converged),
            "totalEnergyHartree": round(energy_ha, 8),
            "homoEv": homo_ev,
            "lumoEv": lumo_ev,
            "homoLumoGapEv": gap_ev,
            "dipoleDebye": dipole_norm,
            "numBasisFunctions": int(mol.nao),
        },
        artifacts=[rec],
    )


def run_ml_property(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    smiles_list = params.get("smilesList") or ([params["smiles"]] if params.get("smiles") else [])
    if not smiles_list:
        raise ValueError("Provide 'smilesList' or 'smiles'.")
    backend = str(params.get("backend") or "chemprop").lower()
    if backend == "deepchem":
        dc = require_module("deepchem", "pip install deepchem")
        return AdapterOutput(
            tool_version=f"deepchem-{getattr(dc, '__version__', 'unknown')}",
            metrics={"count": len(smiles_list), "note": "DeepChem runtime verified; supply checkpointPath for scoring."},
            artifacts=[],
        )
    chemprop = require_module("chemprop", "pip install chemprop")
    checkpoint = str(params.get("checkpointPath") or "").strip()
    if not checkpoint:
        raise ValueError("Supply 'checkpointPath' for Chemprop model inference.")
    exe = require_binary("chemprop", "pip install chemprop")
    in_csv = ctx.write_input("inputs.csv", "smiles\n" + "\n".join(str(s) for s in smiles_list) + "\n")
    out_csv = ctx.job_dir / "predictions.csv"
    ctx.run_cmd([exe, "predict", "--test-path", str(in_csv), "--model-paths", checkpoint, "--preds-path", str(out_csv)])
    rec = ctx.register_artifact(out_csv, "csv", "text/csv")
    return AdapterOutput(
        tool_version=f"chemprop-{getattr(chemprop, '__version__', 'unknown')}",
        metrics={"predictedCount": len(smiles_list)},
        artifacts=[rec],
    )
