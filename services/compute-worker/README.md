# Synlexa Compute Worker (`synlexa-compute`)

> **Research-Use-Only (RUO):** External GPU/HPC compute runner for Synlexa Studio.

Connects **Google Colab**, **local CUDA / Apple Silicon GPUs**, **Docker**, or **RunPod / Lambda / SLURM clusters** directly to Synlexa Studio's **Compute Nodes** panel and **Workflow Canvas**.

## Quickstart (Local Machine)

```bash
cd services/compute-worker
python3 -m synlexa_compute.server --port 4180
```

Copy the printed `synlexa-node://http://127.0.0.1:4180#<token>` pairing string and paste it into **Synlexa Studio -> Compute Nodes -> Pair Node**.

## Installing Scientific Tools on Your Node

```bash
pip install -e ".[server,chemistry,simulation,ai,ml]"
```

Optional external CLI tools auto-detected on `PATH`:
- `vina` / `smina` (Apache-2.0) — AutoDock Vina docking
- `gmx` (LGPL-2.1+ external) — GROMACS large-scale MD
- `boltz` (MIT) — Boltz-2 complex prediction
- `nextflow` / `snakemake` — Workflow pipelines
- `obabel` (GPL-2.0 external, optional user-installed plugin only)

## Google Colab (Free T4 / L4 / A100 GPU)

Open `colab/synlexa_colab_gpu.ipynb` in Google Colab, select the toolboxes you want, run the pairing cell, and paste the `synlexa-node://https://....trycloudflare.com#<token>` URI into Synlexa Studio.
