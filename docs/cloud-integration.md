# Optional Cloud Integration & Self-Hosting Architecture

Synlexa Studio follows the separation principle:

> **Open scientific tools. Commercial cloud infrastructure.**

## Local-First by Default

You can clone, build, self-host, and use all Synlexa Studio scientific features without signing in or connecting to `synlexa.com`:

- BYOK keys (`Anthropic`, `Google Gemini`, `OpenAI / Codex`) stay encrypted locally inside `state.vscdb` (`IndexedDB` WebCrypto AES-256-GCM or native SQLite `~/.synlexa-studio/state.vscdb`).
- Local & Colab GPU jobs connect directly from your browser/workstation to your self-hosted `services/compute-worker` endpoint (`http://127.0.0.1:4180` or `*.trycloudflare.com`) using a bearer token stored locally in the vault.

## Optional Synlexa Cloud Gateway (`VITE_SYNLEXA_CLOUD_URL`)

The client-side auth and assistant modules in [`apps/web/src/lib/studioAuth.ts`](../apps/web/src/lib/studioAuth.ts) and [`apps/web/src/lib/aiProviders.ts`](../apps/web/src/lib/aiProviders.ts) default to `https://synlexa.com` and can be overridden at build time via `VITE_SYNLEXA_CLOUD_URL`:

| Endpoint (relative to `VITE_SYNLEXA_CLOUD_URL`) | Purpose |
|---|---|
| `/auth/studio-connect` | OAuth 2.0 Authorization Code + PKCE (`S256`) login initiation (`deep-link` or `web` popup callback) |
| `/api/studio/token` | Exchanges PKCE `code` + `code_verifier` for a Synlexa account bearer token |
| `/api/studio/assistant` | Optional metered Synlexa Cloud AI proxy for users without personal BYOK keys |

Organizations needing managed multi-tenant biomarker pipelines, shared project storage, SAML/OIDC enterprise SSO, and audited analyst report workflows can pair Studio with the commercial Synlexa Core SaaS at [https://www.synlexa.com](https://www.synlexa.com).

## Self-Hosting the Static Web IDE

A sanitized template for Cloudflare Workers Static Assets is included in [`wrangler.example.jsonc`](../wrangler.example.jsonc):

```bash
pnpm install
node scripts/prepare-wasm.mjs
pnpm --filter @synlexa/studio-web build
cp wrangler.example.jsonc wrangler.local.jsonc
# Edit custom_domain to your domain, then:
npx wrangler deploy --config wrangler.local.jsonc
```
