# Contributor Workflow & Dual-Repository Synchronization

Synlexa maintains:
- **Public Open-Source Repository**: [`https://github.com/Synlexa/synlexa-studio`](https://github.com/Synlexa/synlexa-studio) (Apache-2.0 — home for community PRs, issues, CI, and public GitHub Releases)
- **Private Deployment Mirror**: `nanobiolog/synlexa-studio` (keeps private Cloudflare Cloud deploy/sync automation isolated while keeping **100% identical** application source code, lockfiles, and release versions)
- **Homebrew Taps**: [`https://github.com/Synlexa/homebrew-tap`](https://github.com/Synlexa/homebrew-tap) (`brew tap Synlexa/tap`) and `nanobiolog/homebrew-tap` (updated automatically by `release.yml`)

## Why There Is Zero Dependency or Version Drift

1. **Identical Source & Lockfiles**: Both repositories share the exact same `Cargo.toml`, `Cargo.lock`, `apps/desktop/native/Cargo.lock`, `package.json`, `pnpm-lock.yaml`, `pyproject.toml`, and packaging manifests.
2. **Single-Command Version Management**: Never hand-edit version strings across individual files. Always run:
   ```bash
   node scripts/bump-version.mjs 0.5.0
   ```
   Every PR in both repositories is gated by:
   ```bash
   node scripts/check-version-sync.mjs
   node scripts/check-docs-and-licenses.mjs
   ```
3. **Runtime Version Injection**: `studio-cli`, `synlexa-studio-desktop-native`, Vite `@synlexa/studio-web`, and the `synlexa-studio` npm CLI read versions directly from Cargo/npm manifests at build or runtime rather than hardcoding literals.
4. **No Tracked Binary Wasm Blobs**: `apps/web/public/wasm/` is gitignored and generated via `node scripts/prepare-wasm.mjs` during CI/build/dev, eliminating binary merge conflicts on PRs.

## Private ↔ Public Sync Model (Maintainers)

In the private repository, only `.github/workflows/private-*.yml` (`private-deploy-cloud.yml` and `private-sync-repos.yml`) live exclusively outside the public tree:
- Changes landed in private `main` strip `private-*.yml` cleanly and push/sync forward to `Synlexa/synlexa-studio:main` (+ matching tags `v*`).
- External contributor PRs merged into `Synlexa/synlexa-studio:main` are pulled back into `nanobiolog/synlexa-studio:main` via `private-sync-repos.yml` (`schedule`, `workflow_dispatch`, or `repository_dispatch`), running full `ci.yml` + `check-version-sync.mjs` so no lockfile or version conflict occurs.

### Required Repository Secrets for Full Automated CD (Maintainers Only)

| Repository | Secret Name | Purpose |
|---|---|---|
| `Synlexa/synlexa-studio` (or Org `Synlexa`) | `HOMEBREW_TAP_TOKEN` | Fine-grained PAT (`contents: write`) pushing formula/cask updates to `Synlexa/homebrew-tap` (and `nanobiolog/homebrew-tap`) on `v*` tags |
| `nanobiolog/synlexa-studio` (Private) | `SYNLEXA_PUBLIC_SYNC_TOKEN` | Fine-grained PAT syncing between private `nanobiolog/synlexa-studio` and public `Synlexa/synlexa-studio` |
| `nanobiolog/synlexa-studio` (Private) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploys `studio.synlexa.com` + `/releases/*` automatically on `v*` tags via `private-deploy-cloud.yml` |
