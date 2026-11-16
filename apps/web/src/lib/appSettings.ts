import { useCallback, useEffect, useState } from 'react';
import type { ColorMode } from './colorPalettes';
import type { RenderStyle, ViewportLayout } from './workbenchReducers';

/** User-facing application preferences, persisted locally. */
export interface AppSettings {
  /** Interface scale (root font-size multiplier). Cmd/Ctrl +/− adjusts it. */
  uiScale: number;
  /** Plain-language explanations next to metrics. */
  guidedMode: boolean;
  /** Restore open tabs and split layout on launch. */
  restoreTabs: boolean;
  /** Save every imported structure / compound to the local library. */
  autoSaveImports: boolean;
  /** Ask before deleting library items. */
  confirmDeletes: boolean;
  /** Load the CA II starter comparison when the app opens. */
  loadDemoOnStart: boolean;
  viewer: {
    defaultStyle: RenderStyle;
    defaultColorMode: ColorMode;
    defaultLayout: ViewportLayout;
    embedPngInReports: boolean;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  uiScale: 1,
  guidedMode: true,
  restoreTabs: true,
  autoSaveImports: true,
  confirmDeletes: true,
  loadDemoOnStart: true,
  viewer: {
    defaultStyle: 'ribbon',
    defaultColorMode: 'identity',
    defaultLayout: 'overlay',
    embedPngInReports: true,
  },
};

export const UI_SCALE_MIN = 0.85;
export const UI_SCALE_MAX = 1.35;
export const UI_SCALE_STEP = 0.05;

const LS_KEY = 'synlexa.studio.settings.v2';
const listeners = new Set<(s: AppSettings) => void>();

function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.round(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v)) * 100) / 100;
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      uiScale: clampScale(parsed.uiScale ?? 1),
      viewer: { ...DEFAULT_SETTINGS.viewer, ...(parsed.viewer ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: AppSettings = typeof localStorage !== 'undefined' ? loadSettings() : DEFAULT_SETTINGS;

export function getSettings(): AppSettings {
  return current;
}

export function updateSettings(patch: Partial<AppSettings> | ((s: AppSettings) => AppSettings)): AppSettings {
  const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
  next.uiScale = clampScale(next.uiScale);
  current = next;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // storage full / disabled — keep in memory
  }
  applyUiScale(next.uiScale);
  for (const l of listeners) l(next);
  return next;
}

export function resetSettings(): AppSettings {
  return updateSettings(DEFAULT_SETTINGS);
}

export function applyUiScale(scale: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.fontSize = `${16 * clampScale(scale)}px`;
}

export function stepUiScale(dir: 1 | -1 | 0) {
  const s = getSettings();
  updateSettings({
    uiScale: dir === 0 ? 1 : s.uiScale + dir * UI_SCALE_STEP,
  });
}

export function useAppSettings(): [AppSettings, typeof updateSettings] {
  const [state, setState] = useState<AppSettings>(current);
  useEffect(() => {
    listeners.add(setState);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  const update = useCallback(updateSettings, []);
  return [state, update];
}
