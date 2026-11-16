## Summary
<!-- Describe what this pull request changes and why. -->

## Related Issue
<!-- Fixes #... -->

## Scope & Verification
- [ ] Code changes are scoped and do not include private credentials or compiled `.wasm` binaries (`apps/web/public/wasm/`).
- [ ] `node scripts/check-version-sync.mjs` passes (no unintended version/lockfile drift).
- [ ] `node scripts/check-docs-and-licenses.mjs` passes.
- [ ] Relevant tests ran and passed locally (`cargo test --workspace`, `pnpm --filter @synlexa/studio-web test`, `node benchmarks/run_benchmarks.mjs`, `ctest`, or Python tests).
- [ ] Research-Use-Only (RUO) disclaimer and provenance fields (`sourceUrl`, `license`, `retrievedAtUtc`) remain intact.
