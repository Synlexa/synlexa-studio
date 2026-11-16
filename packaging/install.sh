#!/usr/bin/env sh
set -eu

VERSION="${SYNLEXA_VERSION:-0.4.3}"
INSTALL_DIR="${SYNLEXA_INSTALL_DIR:-$HOME/.synlexa-studio/runtime}"
BIN_DIR="${SYNLEXA_BIN_DIR:-$HOME/.local/bin}"
PRIMARY_RELEASES_BASE="${SYNLEXA_RELEASES_BASE:-https://github.com/Synlexa/synlexa-studio/releases/download/v${VERSION}}"
MIRROR_RELEASES_BASE="https://studio.synlexa.com/releases"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    TARGET="universal-apple-darwin"
    ;;
  Linux)
    case "$ARCH" in
      x86_64|amd64)
        TARGET="x86_64-unknown-linux-gnu"
        ;;
      aarch64|arm64)
        TARGET="aarch64-unknown-linux-gnu"
        ;;
      *)
        echo "Unsupported Linux architecture: $ARCH" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS for install.sh: $OS (use install.ps1 on Windows)" >&2
    exit 1
    ;;
esac

ARCHIVE="synlexa-studio-v${VERSION}-${TARGET}.tar.gz"
PRIMARY_URL="${PRIMARY_RELEASES_BASE}/${ARCHIVE}"
MIRROR_URL="${MIRROR_RELEASES_BASE}/${ARCHIVE}"

mkdir -p "$INSTALL_DIR" "$BIN_DIR"
TMP_ARCHIVE="$(mktemp "/tmp/synlexa-studio-XXXXXX.tar.gz")"
cleanup() {
  rm -f "$TMP_ARCHIVE"
}
trap cleanup EXIT

download_archive() {
  if ! command -v curl >/dev/null 2>&1; then
    return 1
  fi
  curl -fsSL "$PRIMARY_URL" -o "$TMP_ARCHIVE" && return 0
  curl -fsSL "$MIRROR_URL" -o "$TMP_ARCHIVE" && return 0
  return 1
}

echo "Installing Synlexa Studio v${VERSION} (${TARGET})..."
if download_archive; then
  rm -rf "${INSTALL_DIR:?}/bin" "${INSTALL_DIR:?}/web-dist"
  tar -C "$INSTALL_DIR" -xzf "$TMP_ARCHIVE"
  chmod +x "$INSTALL_DIR/bin/"*

  APP_BUNDLE=""
  if [ "$OS" = "Darwin" ]; then
    APP_PARENT="/Applications"
    if [ ! -w "$APP_PARENT" ]; then
      APP_PARENT="$HOME/Applications"
      mkdir -p "$APP_PARENT"
    fi
    APP_BUNDLE="$APP_PARENT/Synlexa Studio.app"
    rm -rf "$APP_BUNDLE"
    mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources/web-dist"
    cp "$INSTALL_DIR/bin/synlexa-studio-desktop-native" "$APP_BUNDLE/Contents/MacOS/synlexa-studio-desktop-native"
    cp "$INSTALL_DIR/bin/studio-cli" "$APP_BUNDLE/Contents/MacOS/studio-cli"
    chmod +x "$APP_BUNDLE/Contents/MacOS/synlexa-studio-desktop-native" "$APP_BUNDLE/Contents/MacOS/studio-cli"
    cp -R "$INSTALL_DIR/web-dist/." "$APP_BUNDLE/Contents/Resources/web-dist/"
    if [ -f "$INSTALL_DIR/icon.icns" ]; then
      cp "$INSTALL_DIR/icon.icns" "$APP_BUNDLE/Contents/Resources/icon.icns"
    fi

    cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Synlexa Studio</string>
  <key>CFBundleDisplayName</key><string>Synlexa Studio</string>
  <key>CFBundleIdentifier</key><string>com.synlexa.studio</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>synlexa-studio-desktop-native</string>
  <key>CFBundleIconFile</key><string>icon.icns</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key><string>com.synlexa.studio.auth</string>
      <key>CFBundleURLSchemes</key><array><string>synlexa-studio</string></array>
    </dict>
  </array>
</dict>
</plist>
PLIST

    if command -v xattr >/dev/null 2>&1; then
      xattr -cr "$INSTALL_DIR" "$APP_BUNDLE" 2>/dev/null || true
    fi
    if command -v codesign >/dev/null 2>&1; then
      codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true
      codesign --force --sign - "$INSTALL_DIR/bin/synlexa-studio-desktop-native" "$INSTALL_DIR/bin/studio-cli" >/dev/null 2>&1 || true
    fi
    LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
    if [ -x "$LSREGISTER" ]; then
      "$LSREGISTER" -f "$APP_BUNDLE" >/dev/null 2>&1 || true
    fi
    if [ -d "$HOME/Desktop" ] && [ -w "$HOME/Desktop" ]; then
      DESKTOP_APP="$HOME/Desktop/Synlexa Studio.app"
      if [ -L "$DESKTOP_APP" ] || [ ! -e "$DESKTOP_APP" ]; then
        rm -f "$DESKTOP_APP"
        ln -s "$APP_BUNDLE" "$DESKTOP_APP"
      fi
    fi
  fi

  cat > "$BIN_DIR/synlexa-studio" <<EOF
#!/usr/bin/env sh
set -eu
case "\${1:-}" in
  mcp|inspect|compare|peptide|gene|smiles|ramachandran|--version|-V|version)
    exec "$INSTALL_DIR/bin/studio-cli" "\$@"
    ;;
  *)
    exec "$INSTALL_DIR/bin/synlexa-studio-desktop-native" --dist "$INSTALL_DIR/web-dist" "\$@"
    ;;
esac
EOF

  cat > "$BIN_DIR/studio-cli" <<EOF
#!/usr/bin/env sh
set -eu
exec "$INSTALL_DIR/bin/studio-cli" "\$@"
EOF

  chmod +x "$BIN_DIR/synlexa-studio" "$BIN_DIR/studio-cli"
  echo "Installed Synlexa Studio runtime into $INSTALL_DIR"
  if [ -n "$APP_BUNDLE" ]; then
    echo "Installed macOS desktop app at: $APP_BUNDLE"
    if [ -L "$HOME/Desktop/Synlexa Studio.app" ]; then
      echo "Created Desktop icon at: $HOME/Desktop/Synlexa Studio.app"
    fi
  elif [ "$OS" = "Linux" ]; then
    XDG_DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
    APPS_DIR="$XDG_DATA/applications"
    ICONS_DIR="$XDG_DATA/icons/hicolor/1024x1024/apps"
    mkdir -p "$APPS_DIR" "$ICONS_DIR"
    ICON_FIELD="synlexa-studio"
    if [ -f "$INSTALL_DIR/icon.png" ]; then
      cp "$INSTALL_DIR/icon.png" "$ICONS_DIR/synlexa-studio.png"
      ICON_FIELD="$ICONS_DIR/synlexa-studio.png"
    fi
    DESKTOP_ENTRY_PATH="$APPS_DIR/synlexa-studio.desktop"
    cat > "$DESKTOP_ENTRY_PATH" <<DESK
[Desktop Entry]
Version=1.0
Type=Application
Name=Synlexa Studio
GenericName=Computational Biology Workbench
Comment=Deterministic Structural Biology & Cheminformatics Workbench (Research-Use-Only)
Exec="$BIN_DIR/synlexa-studio"
Icon=$ICON_FIELD
Categories=Science;Education;Development;
Terminal=false
StartupNotify=true
DESK
    chmod 0755 "$DESKTOP_ENTRY_PATH"
    LINUX_DESKTOP_DIR="$HOME/Desktop"
    if command -v xdg-user-dir >/dev/null 2>&1; then
      XDG_DESK="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
      if [ -n "$XDG_DESK" ] && [ "$XDG_DESK" != "$HOME" ] && [ -d "$XDG_DESK" ]; then
        LINUX_DESKTOP_DIR="$XDG_DESK"
      fi
    fi
    if [ -d "$LINUX_DESKTOP_DIR" ] && [ -w "$LINUX_DESKTOP_DIR" ]; then
      cp "$DESKTOP_ENTRY_PATH" "$LINUX_DESKTOP_DIR/synlexa-studio.desktop"
      chmod 0755 "$LINUX_DESKTOP_DIR/synlexa-studio.desktop"
      if command -v gio >/dev/null 2>&1; then
        gio set "$LINUX_DESKTOP_DIR/synlexa-studio.desktop" metadata::trusted true >/dev/null 2>&1 || true
      fi
      echo "Created Desktop icon at: $LINUX_DESKTOP_DIR/synlexa-studio.desktop"
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database "$APPS_DIR" >/dev/null 2>&1 || true
    fi
    echo "Installed Linux launcher entry at: $DESKTOP_ENTRY_PATH"
  fi
elif command -v npm >/dev/null 2>&1; then
  echo "Native archives unavailable; installing cross-platform package via npm..."
  npm install -g "${PRIMARY_RELEASES_BASE}/synlexa-studio-${VERSION}.tgz" || npm install -g "${MIRROR_RELEASES_BASE}/synlexa-studio-${VERSION}.tgz" || npm install -g @synlexa/studio
  echo "Installed @synlexa/studio globally via npm."
else
  echo "Failed to download $PRIMARY_URL and npm is not installed." >&2
  echo "Install Node.js/npm (https://nodejs.org) or visit https://www.synlexa.com/download" >&2
  exit 1
fi

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "Add $BIN_DIR to your PATH if needed:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    ;;
esac

echo ""
echo "Quick start (For research and development use. Not for diagnostic or treatment decisions.):"
echo "  synlexa-studio              # Launch Synlexa Studio window"
echo "  synlexa-studio mcp --stdio  # Start stdio MCP server for Claude / Codex"
