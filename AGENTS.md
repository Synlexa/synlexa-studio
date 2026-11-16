# Synlexa Studio Contributor & Maintainer Guide

## Product & License Boundary

- **Research-Use-Only (RUO)**: Keep all UI, CLI, MCP, SDK, and documentation strictly research-use-only; never add diagnostic, treatment, clinical-decision, or FDA-clearance claims.
- **License (`Apache-2.0`)**: Everything in this repository is Apache-2.0. Never commit secrets, raw customer/proprietary data, `apps/web/public/wasm/` compiled binaries, `.wrangler/`, or `wrangler.local.jsonc`.
- **Clean attribution**: Use real human Git author metadata and never add automated tool `Co-authored-by` trailers.

## Required Pre-Push Checks

Run these before committing:

```sh
node scripts/check-version-sync.mjs
node scripts/check-docs-and-licenses.mjs
cargo test --workspace --locked
pnpm --filter @synlexa/studio-web lint && pnpm --filter @synlexa/studio-web test && pnpm --filter @synlexa/studio-web build
```

If touching C++20, Wasm parity, native desktop, Python SDK, or compute worker code, also run `ctest`, `node benchmarks/run_benchmarks.mjs`, `cargo test --manifest-path apps/desktop/native/Cargo.toml --locked`, `python3 -m unittest discover -s bindings/python/tests`, and `python3 -m pytest services/compute-worker/tests`.

## Dual-Repo Push & Release Rules (Critical — Do Not Forget `v*` Tags)

Maintainers work against the **private mirror remote (`nanobiolog/synlexa-studio`)** as `origin`, which automatically strips `.github/workflows/private-*.yml` and syncs commits/tags to public **`Synlexa/synlexa-studio`**.

1. **Always check for pending community PRs first**:
   Merge any open `sync/public-main` PR in `nanobiolog/synlexa-studio` before pushing new commits to `main` (otherwise `push-to-public` mirrors the private tree forward cleanly).
2. **Pushing `main` vs. Shipping a Release (`v*` tag)**:
   - Pushing `main` alone (`git push origin main`) syncs code to `Synlexa/synlexa-studio:main` and runs CI, **without** building desktop/CLI installers, updating Homebrew taps, or deploying `studio.synlexa.com`.
   - Whenever publishing a new version or shipping user-facing app/CLI/Wasm/Cloud updates, you **must push a `v*` tag** along with `main`:
     ```sh
     node scripts/bump-version.mjs <X.Y.Z>
     # Update CHANGELOG.md, run verification checks above, then commit on main
     git tag -a "v<X.Y.Z>" -m "Synlexa Studio v<X.Y.Z>"
     git push origin main --follow-tags
     ```
   - Pushing `main` + `v<X.Y.Z>` to `nanobiolog/synlexa-studio` triggers the full release pipeline:
     1. Immediate sync of `main` and `v<X.Y.Z>` to `Synlexa/synlexa-studio`,
     2. Cross-OS GitHub Release artifacts (macOS/Windows/Linux/npm/installers + `SHA256SUMS.txt`),
     3. Automated Formula & Cask PR/commit updates to `Synlexa/homebrew-tap` and `nanobiolog/homebrew-tap`,
     4. Wait-then-deploy of `studio.synlexa.com` + `/releases/*` CDN mirror.
3. **Always bump versions with `scripts/bump-version.mjs`** rather than editing `Cargo.toml` / `package.json` / `pyproject.toml` individually.
4. **If bumping `STUDIO_VERSION`**, also update the marketing/download site (`synlexa-website`) to match.
