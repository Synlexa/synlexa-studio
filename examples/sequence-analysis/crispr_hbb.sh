#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

echo "Tracing HBB (NM_000518.5) Codon 7 c.20A>T missense edit and SpCas9 PAM sites..."
cargo run --quiet -p studio-cli -- gene \
  --transcript NM_000518.5 \
  --codon 7 \
  --edit-bp 2 \
  --new-base T \
  --nuclease SpCas9 \
  --pretty
