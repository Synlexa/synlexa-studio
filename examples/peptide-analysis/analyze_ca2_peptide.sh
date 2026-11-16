#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "Analyzing CA2 N-terminal peptide with H10A mutation and active-site contact focus..."
cargo run --quiet -p studio-cli -- peptide \
  --seq MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRIL \
  --mut H10A \
  --structure tests/fixtures/3HS4.cif \
  --chain A \
  --focus 94 \
  --pretty
