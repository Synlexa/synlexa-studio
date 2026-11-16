from __future__ import annotations

from typing import Any, Callable

from .base import AdapterContext, AdapterOutput
from .chem_qm import run_ml_property, run_pyscf_qm, run_rdkit_3d, run_vina_docking
from .structure_sim import (
    run_boltz_predict,
    run_gromacs_md,
    run_openmm_md,
    run_rfdiffusion_design,
    run_workflow_script,
)

AdapterFn = Callable[[AdapterContext, dict[str, Any]], AdapterOutput]

ADAPTER_REGISTRY: dict[str, AdapterFn] = {
    "rdkit_3d": run_rdkit_3d,
    "vina_docking": run_vina_docking,
    "pyscf_qm": run_pyscf_qm,
    "ml_property": run_ml_property,
    "openmm_md": run_openmm_md,
    "boltz_predict": run_boltz_predict,
    "rfdiffusion_design": run_rfdiffusion_design,
    "gromacs_md": run_gromacs_md,
    "workflow_runner": run_workflow_script,
}
