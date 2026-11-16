/**
 * Locks browser-level page zoom so only the 3D viewport (and other canvases
 * that opt in) respond to pinch / ctrl+wheel. Keyboard zoom shortcuts are
 * remapped to the app's own UI scale, like desktop IDEs.
 */
export function installZoomLock(onUiScaleKey?: (dir: 1 | -1 | 0) => void): () => void {
  if (typeof document === 'undefined') return () => {};

  const onWheel = (e: WheelEvent) => {
    // Trackpad pinch → ctrl+wheel in Chromium/Firefox. Canvases handle it
    // themselves with their own non-passive listeners; we only stop the page.
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  };
  const onGesture = (e: Event) => e.preventDefault(); // Safari pinch
  const onTouchMove = (e: TouchEvent) => {
    if (e.touches.length > 1) e.preventDefault(); // iPad / touch pinch
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (e.key === '=' || e.key === '+') {
      e.preventDefault();
      onUiScaleKey?.(1);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      onUiScaleKey?.(-1);
    } else if (e.key === '0') {
      e.preventDefault();
      onUiScaleKey?.(0);
    }
  };

  const opts: AddEventListenerOptions = { passive: false };
  window.addEventListener('wheel', onWheel, opts);
  document.addEventListener('gesturestart', onGesture, opts);
  document.addEventListener('gesturechange', onGesture, opts);
  document.addEventListener('gestureend', onGesture, opts);
  document.addEventListener('touchmove', onTouchMove, opts);
  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('wheel', onWheel);
    document.removeEventListener('gesturestart', onGesture);
    document.removeEventListener('gesturechange', onGesture);
    document.removeEventListener('gestureend', onGesture);
    document.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('keydown', onKeyDown);
  };
}
