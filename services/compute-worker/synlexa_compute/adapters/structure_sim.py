from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .base import AdapterContext, AdapterOutput, ToolNotInstalledError, require_binary, require_module


def run_openmm_md(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    openmm = require_module("openmm", "conda install -c conda-forge openmm pdbfixer")
    app = require_module("openmm.app", "conda install -c conda-forge openmm")
    unit = require_module("openmm.unit", "conda install -c conda-forge openmm")

    pdb_text = str(params.get("pdbContent") or "").strip()
    if not pdb_text:
        raise ValueError("Missing required parameter 'pdbContent'.")
    steps = max(0, min(500000, int(params.get("steps", 1000))))
    temp_k = float(params.get("temperatureK", 300.0))
    forcefield_name = str(params.get("forcefield") or "amber14-all.xml")
    water_model = str(params.get("waterModel") or "implicit/gbn2.xml")

    in_pdb = ctx.write_input("input.pdb", pdb_text)
    ctx.on_progress(0.15, "Loading PDB topology & force field")
    pdb = app.PDBFile(str(in_pdb))
    ff = app.ForceField(forcefield_name, water_model)
    modeller = app.Modeller(pdb.topology, pdb.positions)
    modeller.addHydrogens(ff)

    system = ff.createSystem(
        modeller.topology,
        nonbondedMethod=app.NoCutoff,
        constraints=app.HBonds,
    )
    integrator = openmm.LangevinMiddleIntegrator(
        temp_k * unit.kelvin,
        1.0 / unit.picosecond,
        0.002 * unit.picoseconds,
    )

    platform = None
    for plat_name in ("CUDA", "OpenCL", "Metal", "CPU"):
        try:
            platform = openmm.Platform.getPlatformByName(plat_name)
            break
        except Exception:
            continue

    sim = (
        app.Simulation(modeller.topology, system, integrator, platform)
        if platform is not None
        else app.Simulation(modeller.topology, system, integrator)
    )
    sim.context.setPositions(modeller.positions)

    initial_energy = sim.context.getState(getEnergy=True).getPotentialEnergy().value_in_unit(unit.kilojoules_per_mole)
    ctx.on_progress(0.35, f"Minimizing energy on {sim.context.getPlatform().getName()}")
    sim.minimizeEnergy(maxIterations=500)
    min_energy = sim.context.getState(getEnergy=True).getPotentialEnergy().value_in_unit(unit.kilojoules_per_mole)

    traj_pdb = ctx.job_dir / "openmm_trajectory.pdb"
    if steps > 0:
        report_every = max(50, steps // 10)
        sim.reporters.append(app.PDBReporter(str(traj_pdb), report_every))
        ctx.on_progress(0.65, f"Running {steps} MD steps ({temp_k} K)")
        sim.step(steps)

    final_state = sim.context.getState(getPositions=True, getEnergy=True)
    final_energy = final_state.getPotentialEnergy().value_in_unit(unit.kilojoules_per_mole)
    out_pdb = ctx.job_dir / "minimized_final.pdb"
    with out_pdb.open("w", encoding="utf-8") as fh:
        app.PDBFile.writeFile(sim.topology, final_state.getPositions(), fh)

    artifacts = [ctx.register_artifact(out_pdb, "pdb", "chemical/x-pdb")]
    if traj_pdb.exists():
        artifacts.append(ctx.register_artifact(traj_pdb, "pdb", "chemical/x-pdb"))

    return AdapterOutput(
        tool_version=f"openmm-{getattr(openmm, '__version__', 'unknown')}",
        metrics={
            "platform": sim.context.getPlatform().getName(),
            "steps": steps,
            "temperatureK": temp_k,
            "initialEnergyKjMol": round(float(initial_energy), 3),
            "minimizedEnergyKjMol": round(float(min_energy), 3),
            "finalEnergyKjMol": round(float(final_energy), 3),
        },
        artifacts=artifacts,
    )


def run_boltz_predict(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    boltz_bin = require_binary("boltz", "pip install boltz")
    sequences = params.get("sequences")
    if not isinstance(sequences, list) or not sequences:
        raise ValueError("Provide 'sequences' list (e.g. [{'id': 'A', 'sequence': 'MSHHW...'}]).")
    use_msa = bool(params.get("useMsaServer", True))

    yaml_lines = ["version: 1", "sequences:"]
    for item in sequences:
        if "smiles" in item:
            yaml_lines.extend([f"  - ligand:", f"      id: {item.get('id', 'B')}", f"      smiles: '{item['smiles']}'"])
        else:
            yaml_lines.extend(
                [
                    f"  - protein:",
                    f"      id: {item.get('id', 'A')}",
                    f"      sequence: {str(item['sequence']).strip()}",
                ]
            )
    yaml_path = ctx.write_input("boltz_input.yaml", "\n".join(yaml_lines) + "\n")
    out_dir = ctx.job_dir / "boltz_out"
    out_dir.mkdir(exist_ok=True)

    ctx.on_progress(0.25, "Running Boltz-2 prediction (MIT)")
    cmd = [boltz_bin, "predict", str(yaml_path), "--out_dir", str(out_dir)]
    if use_msa:
        cmd.append("--use_msa_server")
    ctx.run_cmd(cmd)

    ctx.on_progress(0.85, "Collecting predicted mmCIF & confidence outputs")
    cifs = list(out_dir.rglob("*.cif"))
    confs = list(out_dir.rglob("confidence_*.json"))
    artifacts = []
    for cif in cifs[:3]:
        target = ctx.job_dir / cif.name
        shutil.copy2(cif, target)
        artifacts.append(ctx.register_artifact(target, "cif", "chemical/x-cif"))
    metrics: dict[str, Any] = {"predictedModels": len(cifs)}
    if confs:
        try:
            metrics["confidence"] = json.loads(confs[0].read_text(encoding="utf-8"))
        except Exception:
            pass
    return AdapterOutput(tool_version="boltz-2", metrics=metrics, artifacts=artifacts)


def run_rfdiffusion_design(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    rf_exe = shutil.which("run_inference.py") or shutil.which("rfdiffusion")
    if not rf_exe:
        raise ToolNotInstalledError(
            "RFdiffusion",
            "Install RFdiffusion + ProteinMPNN on your Colab/Docker GPU node",
        )
    contigs = str(params.get("contigs") or "[50-100]").strip()
    num_designs = max(1, min(16, int(params.get("numDesigns", 2))))
    target_pdb = str(params.get("targetPdb") or "").strip()
    out_prefix = ctx.job_dir / "design"

    cmd = [rf_exe, f"inference.output_prefix={out_prefix}", f"contigmap.contigs={contigs}", f"inference.num_designs={num_designs}"]
    if target_pdb:
        in_pdb = ctx.write_input("target.pdb", target_pdb)
        cmd.append(f"inference.input_pdb={in_pdb}")
    if params.get("hotspots"):
        cmd.append(f"ppi.hotspot_res={params['hotspots']}")

    ctx.on_progress(0.3, "Generating protein backbones (RFdiffusion)")
    ctx.run_cmd(cmd)

    pdbs = sorted(ctx.job_dir.glob("design_*.pdb"))
    artifacts = [ctx.register_artifact(p, "pdb", "chemical/x-pdb") for p in pdbs]
    return AdapterOutput(
        tool_version="rfdiffusion",
        metrics={"numDesignsGenerated": len(pdbs), "contigs": contigs},
        artifacts=artifacts,
    )


def run_gromacs_md(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    gmx = require_binary("gmx", "conda install -c conda-forge gromacs  # or apt install gromacs")
    pdb_text = str(params.get("pdbContent") or "").strip()
    if not pdb_text:
        raise ValueError("Missing required parameter 'pdbContent'.")
    forcefield = str(params.get("forcefield") or "amber99sb-ildn")
    water = str(params.get("water") or "tip3p")
    in_pdb = ctx.write_input("input.pdb", pdb_text)
    gro = ctx.job_dir / "processed.gro"
    top = ctx.job_dir / "topol.top"

    ctx.on_progress(0.25, "Running GROMACS pdb2gmx topology preparation (LGPL-2.1+ CLI)")
    ctx.run_cmd([gmx, "pdb2gmx", "-f", str(in_pdb), "-o", str(gro), "-p", str(top), "-ff", forcefield, "-water", water, "-ignh"])
    artifacts = [ctx.register_artifact(gro, "gro", "text/plain")]
    return AdapterOutput(
        tool_version="gromacs-cli",
        metrics={"forcefield": forcefield, "water": water},
        artifacts=artifacts,
    )


def run_workflow_script(ctx: AdapterContext, params: dict[str, Any]) -> AdapterOutput:
    engine = str(params.get("engine") or "snakemake").lower()
    script_text = str(params.get("script") or "").strip()
    if not script_text:
        raise ValueError("Missing workflow 'script'.")
    if engine == "nextflow":
        nf = require_binary("nextflow", "curl -s https://get.nextflow.io | bash")
        nf_file = ctx.write_input("main.nf", script_text)
        ctx.on_progress(0.3, "Running Nextflow pipeline")
        ctx.run_cmd([nf, "run", str(nf_file)])
        return AdapterOutput(tool_version="nextflow", metrics={"engine": "nextflow"}, artifacts=[])

    smk = require_binary("snakemake", "pip install snakemake")
    smk_file = ctx.write_input("Snakefile", script_text)
    ctx.on_progress(0.3, "Running Snakemake pipeline")
    ctx.run_cmd([smk, "--snakefile", str(smk_file), "--cores", "2"])
    return AdapterOutput(tool_version="snakemake", metrics={"engine": "snakemake"}, artifacts=[])
