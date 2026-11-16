#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "Comparing 3HS4 (experimental) vs AF-P00918-F1 v6 (AlphaFold DB) + PAE..."
cargo run --quiet -p studio-cli -- compare \
  --ref tests/fixtures/3HS4.cif --ref-chain A \
  --mob tests/fixtures/AF-P00918-F1-model_v6.cif --mob-chain A \
  --pae tests/fixtures/AF-P00918-F1-predicted_aligned_error_v6.json \
  --pretty
