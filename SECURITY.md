# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Synlexa Studio (including the Web IDE, `synlexa-bio-core`, `studio-cli`, desktop host, Wasm bridge, or `synlexa-compute` worker), please **do not open a public GitHub issue**.

Instead, report it confidentially via one of the following channels:

1. **GitHub Security Advisories (Preferred)**: Open a private advisory on https://github.com/Synlexa/synlexa-studio/security/advisories/new
2. **Email**: Send details and reproduction steps to **security@synlexa.com**

We aim to acknowledge security reports within **48 hours** and provide an assessment and remediation plan within **7 business days**.

## Supported Versions

| Version | Supported |
|---|---|
| `0.4.x` | Yes |
| `< 0.4.0` | Upgrade to latest release |

## Security Architecture Highlights

- **Local BYOK Credential Isolation**: Third-party AI keys (`Anthropic`, `Google Gemini`, `OpenAI`) are stored client-side in `state.vscdb` (`IndexedDB` AES-256-GCM via WebCrypto or machine-key encrypted local SQLite `~/.synlexa-studio/state.vscdb` in desktop mode), never in plain-text project bundles or unencrypted JSON exports.
- **Bounded Parsers**: Rust and C++20 PDB/mmCIF parsers enforce a `50 MiB` input cap and `250,000` atom cap to prevent resource exhaustion when opening malformed structures.
- **Compute Bridge Controls (`synlexa-compute`)**: External GPU/Colab compute endpoints enforce constant-time bearer token verification and canonical path-traversal guards (`safe_job_path`) on uploaded inputs and downloaded artifacts.
- **Optional Cloud Sync**: All offline tools operate without authentication; optional Synlexa Cloud sessions use OAuth 2.0 + PKCE (`S256`).
