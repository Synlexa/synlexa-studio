/**
 * IDE-style editor layout: up to two side-by-side editor groups, each with
 * its own ordered tabs and active tab. Pure reducer + local persistence.
 */
export type ToolTabId =
  | 'home'
  | 'viewer'
  | 'results'
  | 'sequence'
  | 'ramachandran'
  | 'peptide'
  | 'crispr'
  | 'chemistry'
  | 'workflow'
  | 'compute'
  | 'plugins'
  | 'assistant'
  | 'mcp'
  | 'library';

export const ALL_TABS: ToolTabId[] = [
  'home',
  'viewer',
  'results',
  'sequence',
  'ramachandran',
  'peptide',
  'crispr',
  'chemistry',
  'workflow',
  'compute',
  'plugins',
  'assistant',
  'mcp',
  'library',
];

/** Tabs that cannot be closed (the 3D viewer is the heart of the workspace). */
export const PINNED_TABS: ReadonlySet<ToolTabId> = new Set(['viewer']);

export interface EditorGroup {
  tabs: ToolTabId[];
  active: ToolTabId | null;
}

export interface WorkspaceLayout {
  groups: EditorGroup[]; // length 1 or 2
  focused: number;
  /** Fraction of width used by the first group when split. */
  split: number;
}

export const DEFAULT_LAYOUT: WorkspaceLayout = {
  groups: [
    { tabs: ['home', 'viewer'], active: 'home' },
    { tabs: ['assistant', 'results', 'sequence', 'mcp'], active: 'assistant' },
  ],
  focused: 0,
  split: 0.62,
};

export type LayoutAction =
  | { type: 'open'; tab: ToolTabId; toSide?: boolean }
  | { type: 'activate'; tab: ToolTabId }
  | { type: 'close'; tab: ToolTabId }
  | { type: 'close_others'; tab: ToolTabId }
  | { type: 'move'; tab: ToolTabId; toGroup: number; index?: number }
  | { type: 'focus_group'; group: number }
  | { type: 'set_split'; split: number }
  | { type: 'merge_split' }
  | { type: 'reset' };

function findGroup(layout: WorkspaceLayout, tab: ToolTabId): number {
  return layout.groups.findIndex((g) => g.tabs.includes(tab));
}

function normalize(layout: WorkspaceLayout): WorkspaceLayout {
  let groups = layout.groups.filter((g) => g.tabs.length > 0);
  if (groups.length === 0) groups = [{ tabs: ['home', 'viewer'], active: 'home' }];
  groups = groups.map((g) => ({
    tabs: g.tabs,
    active: g.active && g.tabs.includes(g.active) ? g.active : g.tabs[g.tabs.length - 1] ?? null,
  }));
  // The viewer must always exist somewhere.
  if (!groups.some((g) => g.tabs.includes('viewer'))) {
    groups[0] = { ...groups[0], tabs: [...groups[0].tabs, 'viewer'] };
  }
  return {
    groups: groups.slice(0, 2),
    focused: Math.min(layout.focused, groups.length - 1),
    split: Math.min(0.8, Math.max(0.2, layout.split)),
  };
}

export function layoutReducer(state: WorkspaceLayout, action: LayoutAction): WorkspaceLayout {
  switch (action.type) {
    case 'open': {
      const existing = findGroup(state, action.tab);
      if (existing >= 0 && !action.toSide) {
        const groups = state.groups.map((g, i) => (i === existing ? { ...g, active: action.tab } : g));
        return { ...state, groups, focused: existing };
      }
      if (action.toSide) {
        const from = existing >= 0 ? existing : state.focused;
        const target = state.groups.length === 1 ? 1 : 1 - from;
        return layoutReducer(state, { type: 'move', tab: action.tab, toGroup: target });
      }
      const g = state.focused;
      const groups = state.groups.map((grp, i) =>
        i === g ? { tabs: [...grp.tabs, action.tab], active: action.tab } : grp,
      );
      return { ...state, groups };
    }
    case 'activate': {
      const gi = findGroup(state, action.tab);
      if (gi < 0) return layoutReducer(state, { type: 'open', tab: action.tab });
      const groups = state.groups.map((g, i) => (i === gi ? { ...g, active: action.tab } : g));
      return { ...state, groups, focused: gi };
    }
    case 'close': {
      if (PINNED_TABS.has(action.tab)) return state;
      const gi = findGroup(state, action.tab);
      if (gi < 0) return state;
      const groups = state.groups.map((g, i) => {
        if (i !== gi) return g;
        const idx = g.tabs.indexOf(action.tab);
        const tabs = g.tabs.filter((t) => t !== action.tab);
        const active = g.active === action.tab ? tabs[Math.min(idx, tabs.length - 1)] ?? null : g.active;
        return { tabs, active };
      });
      return normalize({ ...state, groups });
    }
    case 'close_others': {
      const gi = findGroup(state, action.tab);
      if (gi < 0) return state;
      const groups = state.groups.map((g, i) =>
        i === gi
          ? { tabs: g.tabs.filter((t) => t === action.tab || PINNED_TABS.has(t)), active: action.tab }
          : g,
      );
      return normalize({ ...state, groups });
    }
    case 'move': {
      const from = findGroup(state, action.tab);
      let groups = state.groups.map((g) => ({ ...g, tabs: [...g.tabs] }));
      if (action.toGroup >= groups.length) groups.push({ tabs: [], active: null });
      if (from >= 0) {
        const src = groups[from];
        const idx = src.tabs.indexOf(action.tab);
        src.tabs.splice(idx, 1);
        if (src.active === action.tab) src.active = src.tabs[Math.min(idx, src.tabs.length - 1)] ?? null;
      }
      const dest = groups[action.toGroup];
      const at = action.index === undefined ? dest.tabs.length : Math.max(0, Math.min(action.index, dest.tabs.length));
      dest.tabs.splice(at, 0, action.tab);
      dest.active = action.tab;
      // If the source group emptied, indices shift — compute focus after normalize.
      const emptied = from >= 0 && groups[from].tabs.length === 0;
      groups = groups.filter((g) => g.tabs.length > 0);
      const focused = emptied && from < action.toGroup ? action.toGroup - 1 : action.toGroup;
      return normalize({ ...state, groups, focused });
    }
    case 'focus_group':
      return { ...state, focused: Math.min(action.group, state.groups.length - 1) };
    case 'set_split':
      return { ...state, split: Math.min(0.8, Math.max(0.2, action.split)) };
    case 'merge_split': {
      if (state.groups.length < 2) return state;
      const focusedGroup = state.groups[state.focused] ?? state.groups[0];
      const mergedTabs = Array.from(new Set(state.groups.flatMap((g) => g.tabs)));
      return normalize({
        ...state,
        groups: [{ tabs: mergedTabs, active: focusedGroup.active ?? mergedTabs[0] ?? null }],
        focused: 0,
      });
    }
    case 'reset':
      return DEFAULT_LAYOUT;
  }
}

const LS_KEY = 'synlexa.studio.layout.v1';

export function loadLayout(restore: boolean): WorkspaceLayout {
  if (!restore) return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as WorkspaceLayout;
    const valid = new Set<string>(ALL_TABS);
    const groups = (parsed.groups ?? [])
      .map((g) => {
        const tabs = Array.from(new Set((g.tabs ?? []).filter((t) => valid.has(t)))) as ToolTabId[];
        return { tabs, active: (g.active && valid.has(g.active) ? g.active : null) as ToolTabId | null };
      })
      .slice(0, 2);
    // De-duplicate across groups
    if (groups.length === 2) groups[1].tabs = groups[1].tabs.filter((t) => !groups[0].tabs.includes(t));
    return normalize({ groups, focused: parsed.focused ?? 0, split: parsed.split ?? 0.6 });
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: WorkspaceLayout) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}
