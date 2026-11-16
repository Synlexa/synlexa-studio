# Synlexa Studio (`@synlexa/studio`)

> **Research-Use-Only (RUO):** Synlexa Studio is for computational research and software evaluation only. It is not intended for diagnostic, therapeutic, clinical-decision, or medical-device use.

**This single package works on all computers** — **macOS (Apple Silicon M1–M4 & Intel)**, **Windows (x64 & ARM64)**, and **Linux**. You do **not** need to pick an architecture-specific package.

---

## Easiest Ways to Install (For Non-Technical Users)

### macOS (Apple Silicon M1–M4 & Intel)

- **Drag-and-Drop Installer (No Terminal Needed):**  
  Download [`Synlexa-Studio-v0.4.3-universal-apple-darwin.dmg`](https://github.com/Synlexa/synlexa-studio/releases/download/v0.4.5/Synlexa-Studio-v0.4.3-universal-apple-darwin.dmg), double-click it, and drag **Synlexa Studio** into **Applications**.
- **Or One-Line Terminal Install (Adds Desktop + Applications Icon Automatically):**
  ```sh
  curl -fsSL https://www.synlexa.com/install.sh | sh
  ```
- **Or Homebrew:**
  ```sh
  brew install --cask Synlexa/tap/synlexa-studio
  ```

### Windows (10 / 11)

Open **PowerShell** and paste:

```powershell
irm https://www.synlexa.com/install.ps1 | iex
```

This installs **Synlexa Studio** and creates clickable shortcuts on your **Desktop** and **Start Menu**.

### Linux

Run in Terminal (adds a **Synlexa Studio** Desktop & Applications menu icon):

```sh
curl -fsSL https://www.synlexa.com/install.sh | sh
```

*(Debian/Ubuntu `.deb` and portable `.AppImage` files are also available on [GitHub Releases](https://github.com/Synlexa/synlexa-studio/releases).)*

---

## Installing via `npm`

```sh
npm install -g @synlexa/studio
synlexa-studio
```

On npm v12+ (where install-time lifecycle scripts default off), launching `synlexa-studio` the first time (or passing `--allow-scripts`) automatically verifies the native desktop runtime for your computer and adds the clickable **Synlexa Studio** Desktop & Applications/Start Menu icon.

*(Alternative: install the release tarball directly or via GitHub Packages with `read:packages`:)*

```sh
npm install -g https://github.com/Synlexa/synlexa-studio/releases/download/v0.4.5/synlexa-studio-0.4.5.tgz
# Or GitHub Packages:
npm install -g @synlexa/studio --@synlexa:registry=https://npm.pkg.github.com
```

### Launching After Install

- **From your Desktop / App Launcher (no CLI needed):**  
  Double-click the **Synlexa Studio** icon on your **Desktop** (or open it from **macOS Applications / Spotlight**, **Windows Start Menu**, or **Linux Applications**).
- **From Terminal:**
  ```sh
  synlexa-studio                  # Open Synlexa Studio window
  synlexa-studio install-desktop  # Recreate the Desktop icon anytime
  synlexa-studio mcp --stdio      # Start stdio MCP server for Claude / Codex / Cursor
  ```
- **Browser App (Zero Install):**  
  Open [https://studio.synlexa.com](https://studio.synlexa.com).
