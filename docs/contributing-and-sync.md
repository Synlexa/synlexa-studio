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
- **Private → Public (Immediate on Push)**: Commits pushed to `nanobiolog/synlexa-studio:main` and `v*` release tags strip `private-*.yml` cleanly and push directly to `Synlexa/synlexa-studio:main` (+ matching `v*` tags).
- **Public → Private (Scheduled / Manual Sync PR)**: External contributor PRs merged into `Synlexa/synlexa-studio:main` are checked automatically every 6 hours by `private-sync-repos.yml` (`schedule`) or on demand via `workflow_dispatch` (`direction=pull-from-public`). When public changes are ahead, it runs `ci` checks and opens a `sync/public-main` → `main` Pull Request in `nanobiolog/synlexa-studio`.
- **Important Ordering Rule**: Merge any open `sync/public-main` PR in `nanobiolog/synlexa-studio` before pushing new commits directly to private `main`, because `push-to-public` mirrors the private tree forward via `rsync --delete`. Similarly, always push release `v*` tags to `nanobiolog/synlexa-studio` so Cloud CDN deploy (`private-deploy-cloud.yml`), public repo tag sync, public GitHub Release builds, and Homebrew tap updates all fire in sync.

## Release & Push Checklist (Maintainers — Never Forget `v*` Tags)

Pushing to `main` alone only syncs source code and runs CI; **desktop installers, CLI archives, Homebrew Formula/Cask updates, and `studio.synlexa.com` Cloud CDN deploys only trigger on `v*` tags**:

1. Merge any open `sync/public-main` PR in `nanobiolog/synlexa-studio` before pushing new private commits:
   ```bash
   gh pr list --repo nanobiolog/synlexa-studio --head sync/public-main
   ```
2. Bump all manifests cleanly and update [`CHANGELOG.md`](../CHANGELOG.md):
   ```bash
   node scripts/bump-version.mjs <X.Y.Z>
   node scripts/check-version-sync.mjs
   node scripts/check-docs-and-licenses.mjs
   ```
3. Commit on `main` (excluding generated `apps/web/public/wasm/` or `.wrangler/` files), create an annotated `v*` tag, and **push both branch and tag** to private `origin` (`nanobiolog/synlexa-studio`):
   ```bash
   git tag -a "v<X.Y.Z>" -m "Synlexa Studio v<X.Y.Z>"
   git push origin main --follow-tags
   ```
   Never create or push a release `v*` tag directly on `Synlexa/synlexa-studio` without pushing through `nanobiolog/synlexa-studio` first, or `private-deploy-cloud.yml` will not run for `studio.synlexa.com`.

### Required Repository Secrets for Full Automated CD (Maintainers Only)

| Repository | Secret Name | Purpose |
|---|---|---|
| `Synlexa/synlexa-studio` (set here only) | `HOMEBREW_TAP_TOKEN` | Classic PAT (`repo` scope) pushing formula/cask updates to both `Synlexa/homebrew-tap` and `nanobiolog/homebrew-tap` on `v*` tags |
| `Synlexa/synlexa-studio` (OIDC) | *No static secret* (`id-token: write`) | Publishes `@synlexa/studio` and `@synlexa/wasm-bridge` to `registry.npmjs.org` via npm Trusted Publishing (`release.yml`); GitHub Packages publishes via `GITHUB_TOKEN` (`packages: write`) |
| `nanobiolog/synlexa-studio` (Private) | `SYNLEXA_PUBLIC_SYNC_TOKEN` | Fine-grained PAT (`Synlexa/synlexa-studio` scoped: `Contents: Read and write`, `Workflows: Read and write`) syncing private ↔ public |
| `nanobiolog/synlexa-studio` (Private) | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Deploys `studio.synlexa.com` + `/releases/*` automatically on `v*` tags via `private-deploy-cloud.yml` |
