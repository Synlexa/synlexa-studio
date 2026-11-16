from __future__ import annotations

import importlib.metadata
import os
import platform
import shutil
import socket
import subprocess
import sys

from .models import GpuDeviceInfo, HardwareCapabilities, ToolCapability


def _detect_ram_mb() -> int | None:
    try:
        if sys.platform == "linux":
            with open("/proc/meminfo", "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        return kb // 1024
        if sys.platform == "darwin":
            out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True, timeout=2)
            return int(out.strip()) // (1024 * 1024)
    except Exception:
        return None
    return None


def _detect_gpus() -> list[GpuDeviceInfo]:
    gpus: list[GpuDeviceInfo] = []
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi:
        try:
            out = subprocess.check_output(
                [
                    nvidia_smi,
                    "--query-gpu=index,name,memory.total,driver_version",
                    "--format=csv,noheader,nounits",
                ],
                text=True,
                timeout=3,
            )
            for line in out.strip().splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 4:
                    gpus.append(
                        GpuDeviceInfo(
                            index=int(parts[0]),
                            name=parts[1],
                            backend="cuda",
                            vram_mb=int(float(parts[2])) if parts[2].replace(".", "", 1).isdigit() else None,
                            driver_version=parts[3],
                        )
                    )
        except Exception:
            pass

    if not gpus and sys.platform == "darwin" and platform.machine() == "arm64":
        gpus.append(
            GpuDeviceInfo(
                index=0,
                name="Apple Silicon Unified GPU (Metal / OpenCL)",
                backend="metal",
                vram_mb=_detect_ram_mb(),
                driver_version=platform.mac_ver()[0] or None,
            )
        )
    return gpus


def _pkg_version(dist_name: str) -> str | None:
    try:
        return importlib.metadata.version(dist_name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _bin_version(cmd: str, args: list[str] | None = None) -> str | None:
    exe = shutil.which(cmd)
    if not exe:
        return None
    try:
        out = subprocess.check_output([exe, *(args or ["--version"])], stderr=subprocess.STDOUT, text=True, timeout=3)
        first = out.strip().splitlines()[0] if out.strip() else "installed"
        return first[:80]
    except Exception:
        return f"installed ({exe})"


def probe_tools() -> list[ToolCapability]:
    vina_ver = _bin_version("vina", ["--version"]) or _pkg_version("vina")
    smina_ver = _bin_version("smina", ["--version"])
    openmm_ver = _pkg_version("openmm")
    gmx_ver = _bin_version("gmx", ["--version"])
    boltz_ver = _pkg_version("boltz") or _bin_version("boltz", ["--help"])
    rfdiff_ver = _pkg_version("rfdiffusion") or _bin_version("run_inference.py", ["--help"])
    mpnn_ver = _pkg_version("proteinmpnn") or _bin_version("proteinmpnn", ["--help"])
    pyscf_ver = _pkg_version("pyscf")
    xtb_ver = _bin_version("xtb", ["--version"])
    chemprop_ver = _pkg_version("chemprop")
    deepchem_ver = _pkg_version("deepchem")
    rdkit_ver = _pkg_version("rdkit")
    nf_ver = _bin_version("nextflow", ["-version"])
    smk_ver = _bin_version("snakemake", ["--version"]) or _pkg_version("snakemake")
    bio_ver = _pkg_version("biopython")
    sam_ver = _bin_version("samtools", ["--version"])
    obabel_ver = _bin_version("obabel", ["-V"])

    return [
        ToolCapability(
            id="vina_docking",
            name="AutoDock Vina / Smina",
            category="Molecular docking",
            license="Apache-2.0",
            commercial_safe=True,
            installed=bool(vina_ver or smina_ver),
            version=vina_ver or smina_ver,
            install_hint="pip install vina meeko rdkit  # or conda install -c conda-forge autodock-vina",
        ),
        ToolCapability(
            id="openmm_md",
            name="OpenMM",
            category="Molecular dynamics",
            license="MIT / LGPL",
            commercial_safe=True,
            installed=bool(openmm_ver),
            version=openmm_ver,
            install_hint="conda install -c conda-forge openmm pdbfixer",
            requires_gpu=False,
        ),
        ToolCapability(
            id="gromacs_md",
            name="GROMACS",
            category="Molecular dynamics",
            license="LGPL-2.1+",
            commercial_safe=True,
            installed=bool(gmx_ver),
            version=gmx_ver,
            install_hint="conda install -c conda-forge gromacs  # or apt install gromacs",
            requires_gpu=False,
        ),
        ToolCapability(
            id="boltz_predict",
            name="Boltz-2",
            category="Protein & complex structure prediction",
            license="MIT (code & weights)",
            commercial_safe=True,
            installed=bool(boltz_ver),
            version=boltz_ver,
            install_hint="pip install boltz",
            requires_gpu=True,
        ),
        ToolCapability(
            id="rfdiffusion_design",
            name="RFdiffusion + ProteinMPNN",
            category="De novo protein design",
            license="BSD / MIT (check weights)",
            commercial_safe=True,
            installed=bool(rfdiff_ver or mpnn_ver),
            version=rfdiff_ver or mpnn_ver,
            install_hint="Install RFdiffusion + ProteinMPNN in Colab/Docker GPU environment",
            requires_gpu=True,
        ),
        ToolCapability(
            id="pyscf_qm",
            name="PySCF",
            category="Quantum chemistry",
            license="Apache-2.0",
            commercial_safe=True,
            installed=bool(pyscf_ver),
            version=pyscf_ver,
            install_hint="pip install pyscf",
        ),
        ToolCapability(
            id="xtb_qm",
            name="xTB (GFN2-xTB)",
            category="Quantum chemistry",
            license="LGPL-3.0",
            commercial_safe=True,
            installed=bool(xtb_ver),
            version=xtb_ver,
            install_hint="conda install -c conda-forge xtb",
        ),
        ToolCapability(
            id="ml_property",
            name="Chemprop / DeepChem",
            category="Cheminformatics ML",
            license="MIT",
            commercial_safe=True,
            installed=bool(chemprop_ver or deepchem_ver),
            version=chemprop_ver or deepchem_ver,
            install_hint="pip install chemprop rdkit",
        ),
        ToolCapability(
            id="rdkit_3d",
            name="RDKit Python (ETKDGv3 3D)",
            category="Molecular modeling",
            license="BSD-3-Clause",
            commercial_safe=True,
            installed=bool(rdkit_ver),
            version=rdkit_ver,
            install_hint="pip install rdkit",
        ),
        ToolCapability(
            id="workflow_runner",
            name="Nextflow / Snakemake",
            category="Scientific workflow orchestration",
            license="Apache-2.0 / MIT",
            commercial_safe=True,
            installed=bool(nf_ver or smk_ver),
            version=nf_ver or smk_ver,
            install_hint="pip install snakemake  # or curl -s https://get.nextflow.io | bash",
        ),
        ToolCapability(
            id="genomics_bio",
            name="Biopython / Samtools (HTSlib)",
            category="Genomics & sequences",
            license="BSD-3 / MIT",
            commercial_safe=True,
            installed=bool(bio_ver or sam_ver),
            version=bio_ver or sam_ver,
            install_hint="pip install biopython && conda install -c bioconda samtools",
        ),
        ToolCapability(
            id="openbabel_external",
            name="Open Babel (External GPL Plugin)",
            category="Molecular format conversion",
            license="GPL-2.0-external",
            commercial_safe=False,
            installed=bool(obabel_ver),
            version=obabel_ver,
            install_hint="User-installed external CLI only (GPL-2.0): brew/apt/conda install openbabel",
        ),
    ]


def probe_hardware() -> HardwareCapabilities:
    return HardwareCapabilities(
        hostname=socket.gethostname(),
        os_name=platform.system(),
        arch=platform.machine(),
        python_version=platform.python_version(),
        cpu_cores=os.cpu_count() or 1,
        ram_mb=_detect_ram_mb(),
        gpus=_detect_gpus(),
        tools=probe_tools(),
    )
