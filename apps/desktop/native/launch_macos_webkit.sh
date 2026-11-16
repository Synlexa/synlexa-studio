#!/usr/bin/env bash
set -euo pipefail

# Optional macOS AppKit / WKWebView native wrapper launcher for Synlexa Studio.
# Starts the zero-dependency Rust localhost host if no URL is provided, then opens
# a native macOS WebKit window using Swift (if available) or falls back to `open`.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST_DIR="${1:-$STUDIO_ROOT/apps/web/dist}"

if ! command -v swift >/dev/null 2>&1; then
  echo "Swift not found; falling back to Rust native launcher + default browser."
  exec cargo run --manifest-path "$SCRIPT_DIR/Cargo.toml" -- --dist "$DIST_DIR"
fi

PORT="${SYNLEXA_PORT:-4179}"
cargo run --manifest-path "$SCRIPT_DIR/Cargo.toml" -- --dist "$DIST_DIR" --port "$PORT" --no-open &
HOST_PID=$!
trap 'kill "$HOST_PID" 2>/dev/null || true' EXIT

sleep 1
URL="http://127.0.0.1:${PORT}/"
echo "Launching macOS WebKit host (RUO) -> $URL"

swift -e '
import Cocoa
import WebKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
    styleMask: [.titled, .closable, .miniaturizable, .resizable],
    backing: .buffered,
    defer: false
)
window.title = "Synlexa Studio (Research-Use-Only)"
window.center()
let webView = WKWebView(frame: window.contentView!.bounds)
webView.autoresizingMask = [.width, .height]
window.contentView?.addSubview(webView)
if let url = URL(string: CommandLine.arguments.last ?? "http://127.0.0.1:4179/") {
    webView.load(URLRequest(url: url))
}
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps: true)
app.run()
' "$URL"
