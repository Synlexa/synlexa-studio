import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type PointerEvent,
} from 'react';
import {
  Camera,
  Compass,
  Crosshair,
  Maximize2,
  Ruler,
  SplitSquareHorizontal,
} from 'lucide-react';
import type {
  CompareStructuresResult,
  InspectStructureResult,
} from '@synlexa/wasm-bridge';
import type { ColorMode } from '../lib/colorPalettes';
import {
  MolecularViewportEngine,
  type CameraState,
  type ScreenPickTarget,
} from '../lib/molRenderer3d';
import { buildMolecularScene, type SceneResidueNode } from '../lib/structureAtoms';
import type {
  CameraPreset,
  RenderStyle,
  ViewportLayout,
} from '../lib/workbenchReducers';

export interface MolecularViewportHandle {
  capturePngDataUrl: () => string | null;
  applyPreset: (preset: CameraPreset) => void;
}

interface MolecularViewportProps {
  comparison: CompareStructuresResult | null;
  refInspect: InspectStructureResult | null;
  mobInspect: InspectStructureResult | null;
  refChainId: string;
  mobChainId: string;
  layout: ViewportLayout;
  onChangeLayout: (layout: ViewportLayout) => void;
  style: RenderStyle;
  onChangeStyle: (style: RenderStyle) => void;
  colorMode: ColorMode;
  onChangeColorMode: (mode: ColorMode) => void;
  focusedSeqId: number | null;
  highlightedSeqIds: Set<number>;
  paePair: [number, number] | null;
  onPickResidue: (seqId: number) => void;
  onRendererModeDetected?: (mode: 'webgl2' | 'canvas2d-fallback') => void;
  simpleMode?: boolean;
}

export const MolecularViewport = forwardRef<
  MolecularViewportHandle,
  MolecularViewportProps
>(function MolecularViewport(
  {
    comparison,
    refInspect,
    mobInspect,
    refChainId,
    mobChainId,
    layout,
    onChangeLayout,
    style,
    onChangeStyle,
    colorMode,
    onChangeColorMode,
    focusedSeqId,
    highlightedSeqIds,
    paePair,
    onPickResidue,
    onRendererModeDetected,
    simpleMode = false,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<MolecularViewportEngine | null>(null);
  const pickTargetsRef = useRef<ScreenPickTarget[]>([]);

  const [size, setSize] = useState({ width: 800, height: 420 });
  const [measureMode, setMeasureMode] = useState(false);
  const [distancePair, setDistancePair] = useState<
    [SceneResidueNode | null, SceneResidueNode | null]
  >([null, null]);
  const [hoverInfo, setHoverInfo] = useState<string | null>(null);

  const scene = useMemo(
    () =>
      buildMolecularScene({
        comparison,
        refInspect,
        mobInspect,
        refChainId,
        mobChainId,
        colorMode,
        highlightedSeqIds,
      }),
    [
      comparison,
      refInspect,
      mobInspect,
      refChainId,
      mobChainId,
      colorMode,
      highlightedSeqIds,
    ],
  );

  const [camera, setCamera] = useState<CameraState>({
    yaw: 0.55,
    pitch: 0.25,
    distance: 68,
    target: [0, 0, 0],
  });

  // Auto-center when scene changes for the first time or structure reloads
  const sceneKeyRef = useRef<string>('');
  useEffect(() => {
    const key = `${comparison?.reference.sha256 ?? ''}:${comparison?.mobile.sha256 ?? ''}:${scene.refResidues.length}`;
    if (key !== sceneKeyRef.current && scene.refResidues.length + scene.mobResidues.length > 0) {
      sceneKeyRef.current = key;
      setCamera({
        yaw: 0.55,
        pitch: 0.25,
        distance: Math.max(36, scene.radius * 2.55),
        target: [...scene.center],
      });
    }
  }, [comparison, scene]);

  const applyPreset = (preset: CameraPreset) => {
    if (preset === 'active-site' && scene.activeSiteCenter) {
      setCamera({
        yaw: 0.9,
        pitch: 0.2,
        distance: 20,
        target: [...scene.activeSiteCenter],
      });
      onChangeStyle('pocket');
    } else if (preset === 'n-terminus' && scene.nTermCenter) {
      setCamera({
        yaw: -0.4,
        pitch: 0.3,
        distance: 24,
        target: [...scene.nTermCenter],
      });
    } else {
      setCamera({
        yaw: 0.55,
        pitch: 0.25,
        distance: Math.max(36, scene.radius * 2.55),
        target: [...scene.center],
      });
    }
  };

  const capturePngDataUrl = (): string | null => {
    const glCanvas = glCanvasRef.current;
    const hudCanvas = hudCanvasRef.current;
    if (!glCanvas || !hudCanvas) return null;

    const out = document.createElement('canvas');
    out.width = glCanvas.width;
    out.height = glCanvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(glCanvas, 0, 0);
    ctx.drawImage(hudCanvas, 0, 0);

    // Stamp subtle RUO caption on exported PNG figure
    const dpr = window.devicePixelRatio || 1;
    ctx.fillStyle = 'rgba(9, 13, 20, 0.85)';
    ctx.fillRect(0, out.height - 24 * dpr, out.width, 24 * dpr);
    ctx.fillStyle = '#fbbf24';
    ctx.font = `600 ${Math.round(11 * dpr)}px ui-monospace, monospace`;
    ctx.fillText(
      `SYNLEXA STUDIO · RESEARCH USE ONLY (RUO) · ${comparison ? `RMSD ${comparison.metrics.rmsdAngstrom.toFixed(3)} A (${comparison.metrics.matchedCaCount} Ca)` : '3D Structure View'}`,
      10 * dpr,
      out.height - 8 * dpr,
    );
    return out.toDataURL('image/png');
  };

  useImperativeHandle(ref, () => ({
    capturePngDataUrl,
    applyPreset,
  }));

  const exportPngDownload = () => {
    const dataUrl = capturePngDataUrl();
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `synlexa-studio-ruo-viewport-${Date.now()}.png`;
    a.click();
  };

  // Observe container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({
          width: Math.max(200, Math.floor(entry.contentRect.width)),
          height: Math.max(180, Math.floor(entry.contentRect.height)),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Init renderer once
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas || engineRef.current) return;
    const engine = new MolecularViewportEngine(glCanvas);
    engineRef.current = engine;
    onRendererModeDetected?.(engine.mode);
  }, [onRendererModeDetected]);

  // Render whenever state/camera/size updates
  useEffect(() => {
    const engine = engineRef.current;
    const hudCanvas = hudCanvasRef.current;
    if (!engine || !hudCanvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    pickTargetsRef.current = engine.render(
      scene,
      {
        layout,
        style,
        camera,
        focusedSeqId,
        highlightedSeqIds,
        distancePair,
        paePair,
      },
      hudCanvas,
      size.width,
      size.height,
      dpr,
    );
  }, [
    scene,
    layout,
    style,
    camera,
    focusedSeqId,
    highlightedSeqIds,
    distancePair,
    paePair,
    size,
  ]);

  // Mouse orbit/pan/pick
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    pan: boolean;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    pan: false,
  });

  const findNearestTarget = (x: number, y: number): ScreenPickTarget | null => {
    let best: ScreenPickTarget | null = null;
    let bestScore = Infinity;
    for (const t of pickTargetsRef.current) {
      const dx = t.sx - x;
      const dy = t.sy - y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= 196) {
        // 14px radius; prefer closest screen hit & shallower depth
        const score = distSq + (t.depth + 1) * 15;
        if (score < bestScore) {
          bestScore = score;
          best = t;
        }
      }
    }
    return best;
  };

  // ---- Unified pointer / wheel / pinch interaction ----------------------
  // Only the 3D canvas zooms, orbits, and pans; page-level zoom is blocked
  // globally (see lib/zoomLock.ts) so UI chrome stays fixed.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  const zoomBy = (factor: number) => {
    setCamera((cam) => ({
      ...cam,
      distance: Math.max(4, Math.min(320, cam.distance * factor)),
    }));
  };

  const panBy = (dx: number, dy: number) => {
    setCamera((cam) => {
      const scale = cam.distance * 0.0018;
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      return {
        ...cam,
        target: [
          cam.target[0] - dx * scale * cy,
          cam.target[1] + dy * scale,
          cam.target[2] + dx * scale * sy,
        ],
      };
    });
  };

  const orbitBy = (dx: number, dy: number) => {
    setCamera((cam) => ({
      ...cam,
      yaw: cam.yaw - dx * 0.0085,
      pitch: Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.0085)),
    }));
  };

  const pinchMetrics = () => {
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-viewport-ui]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      pinchRef.current = pinchMetrics();
      dragRef.current.moved = true;
      return;
    }
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      pan: e.shiftKey || e.button === 2 || e.button === 1,
    };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger touch: pinch to zoom + drag to pan
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const next = pinchMetrics();
      if (next && next.dist > 0 && pinchRef.current.dist > 0) {
        zoomBy(pinchRef.current.dist / next.dist);
        panBy(next.cx - pinchRef.current.cx, next.cy - pinchRef.current.cy);
        pinchRef.current = next;
      }
      return;
    }

    if (!dragRef.current.active) {
      if (e.pointerType === 'mouse') {
        const hit = findNearestTarget(localX, localY);
        setHoverInfo(hit ? hit.label : null);
      }
      return;
    }

    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    if (
      Math.abs(e.clientX - dragRef.current.startX) > 3 ||
      Math.abs(e.clientY - dragRef.current.startY) > 3
    ) {
      dragRef.current.moved = true;
    }
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;

    if (dragRef.current.pan) panBy(dx, dy);
    else orbitBy(dx, dy);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const hadPinch = pointersRef.current.size >= 2;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (hadPinch) {
      dragRef.current.active = false;
      return;
    }
    if (!dragRef.current.active) return;
    const wasMoved = dragRef.current.moved;
    dragRef.current.active = false;
    if (wasMoved) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const hit = findNearestTarget(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) return;

    if (measureMode) {
      const node =
        scene.refResidues.find((r) => r.seqId === hit.seqId) ??
        scene.mobResidues.find((r) => r.seqId === hit.seqId) ??
        null;
      if (node) {
        setDistancePair(([a, b]) => {
          if (!a || (a && b)) return [node, null];
          return [a, node];
        });
      }
    } else {
      onPickResidue(hit.seqId);
    }
  };

  // Native, non-passive wheel + Safari gesture listeners so we can
  // preventDefault and keep the browser from zooming the whole page.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-viewport-ui]')) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dy = e.deltaY * unit;
      if (e.ctrlKey) {
        // Trackpad pinch (Chrome/Edge/Firefox) arrives as ctrl+wheel
        zoomBy(Math.exp(dy * 0.012));
      } else if (e.shiftKey) {
        panBy(-e.deltaX * unit, -dy);
      } else {
        zoomBy(Math.exp(dy * 0.0015));
      }
    };
    let gestureStartDistance = 0;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      setCamera((cam) => {
        gestureStartDistance = cam.distance;
        return cam;
      });
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale ?? 1;
      if (gestureStartDistance > 0 && scale > 0) {
        setCamera((cam) => ({
          ...cam,
          distance: Math.max(4, Math.min(320, gestureStartDistance / scale)),
        }));
      }
    };
    const onGestureEnd = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart, { passive: false } as AddEventListenerOptions);
    el.addEventListener('gesturechange', onGestureChange, { passive: false } as AddEventListenerOptions);
    el.addEventListener('gestureend', onGestureEnd, { passive: false } as AddEventListenerOptions);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse' && !dragRef.current.active) setHoverInfo(null);
      }}
      style={{ touchAction: 'none' }}
      className="relative h-full w-full cursor-grab overflow-hidden bg-[#090d14] select-none overscroll-none active:cursor-grabbing"
    >
      <canvas ref={glCanvasRef} className="absolute inset-0 h-full w-full" />
      <canvas
        ref={hudCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* Top Overlay Toolbar */}
      <div
        data-viewport-ui
        className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 flex flex-wrap items-center justify-between gap-2"
      >
        <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0d121b]/85 p-1 shadow-xl backdrop-blur-md">
          {(
            [
              ['overlay', 'Overlay'],
              ['split', 'Split'],
              ['reference', 'Ref Only'],
              ['mobile', 'Pred Only'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeLayout(id)}
              className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.75rem] font-medium transition ${
                layout === id
                  ? 'bg-white/[0.12] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {id === 'split' && <SplitSquareHorizontal className="h-3.5 w-3.5" />}
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0d121b]/85 p-1 shadow-xl backdrop-blur-md">
          {(
            [
              ['ribbon', 'Ribbon'],
              ['trace', 'Cα Trace'],
              ['pocket', 'Active Pocket'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeStyle(id)}
              className={`rounded-lg px-2.5 py-1 text-[0.75rem] font-medium transition ${
                style === id
                  ? 'bg-white/[0.12] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0d121b]/85 p-1 shadow-xl backdrop-blur-md">
          {(
            [
              ['identity', 'Identity'],
              ['plddt', 'pLDDT'],
              ['bfactor', 'B-Factor (Å²)'],
              ['deviation', 'Δd (Å)'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onChangeColorMode(id)}
              className={`rounded-lg px-2.5 py-1 text-[0.75rem] font-medium transition ${
                colorMode === id
                  ? 'bg-white/[0.12] text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottom Controls & Legend */}
      <div
        data-viewport-ui
        className="pointer-events-none absolute right-2.5 bottom-2.5 left-2.5 flex flex-wrap items-end justify-between gap-2"
      >
        {/* Presets + Measure + Export PNG */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0d121b]/85 p-1 shadow-xl backdrop-blur-md">
          <button
            type="button"
            onClick={() => applyPreset('overview')}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.75rem] text-slate-300 hover:bg-white/[0.07]"
          >
            <Maximize2 className="h-3.5 w-3.5" /> Overview
          </button>
          <button
            type="button"
            onClick={() => applyPreset('active-site')}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.75rem] text-slate-200 hover:bg-white/[0.07]"
          >
            <Crosshair className="h-3.5 w-3.5" /> Active Site
          </button>
          {!simpleMode && (
            <>
              <button
                type="button"
                onClick={() => applyPreset('n-terminus')}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.75rem] text-slate-300 hover:bg-white/[0.07]"
              >
                <Compass className="h-3.5 w-3.5" /> N-Term
              </button>
              <button
                type="button"
                onClick={() => applyPreset('reset')}
                className="rounded-lg px-2.5 py-1 text-[0.75rem] text-slate-400 hover:bg-white/[0.07] hover:text-slate-200"
              >
                Reset
              </button>
              <span className="mx-0.5 h-3.5 w-px bg-slate-800" />
              <button
                type="button"
                onClick={() => {
                  setMeasureMode((m) => !m);
                  if (measureMode) setDistancePair([null, null]);
                }}
                className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.75rem] transition ${
                  measureMode
                    ? 'border border-rose-500/50 bg-rose-500/20 text-rose-200'
                    : 'text-slate-300 hover:bg-white/[0.07]'
                }`}
              >
                <Ruler className="h-3.5 w-3.5" />
                <span>{measureMode ? 'Pick 2 Residues' : 'Distance (Å)'}</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={exportPngDownload}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[0.75rem] text-slate-200 hover:bg-white/[0.07]"
          >
            <Camera className="h-3.5 w-3.5" /> PNG
          </button>
        </div>

        {/* Distinct Scientific Legend */}
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d121b]/85 px-3 py-1.5 font-mono text-[0.75rem] text-slate-300 shadow-lg backdrop-blur-md">
          {hoverInfo && (
            <span className="border-r border-slate-700 pr-2 text-amber-300">
              {hoverInfo}
            </span>
          )}
          {colorMode === 'identity' && (
            <span className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-full bg-sky-400" /> Ref
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-full bg-emerald-400" /> Pred
              </span>
              <span className="flex items-center gap-1">
                <i className="inline-block h-2 w-2 rounded-full bg-purple-400" /> Zn²⁺
              </span>
            </span>
          )}
          {colorMode === 'plddt' && (
            <span className="flex items-center gap-1.5" title="AlphaFold pLDDT confidence (distinct from B-factor)">
              <span className="text-slate-400">pLDDT:</span>
              <span className="text-[#2684ff]">■ ≥90</span>
              <span className="text-[#65cbf3]">■ 70-90</span>
              <span className="text-[#ffdb13]">■ 50-70</span>
              <span className="text-[#ff7d45]">■ &lt;50</span>
            </span>
          )}
          {colorMode === 'bfactor' && (
            <span className="flex items-center gap-1.5" title="Experimental B-factor in Angstrom^2 (Plasma scale, never conflated with pLDDT)">
              <span className="text-slate-400">Exp B (Å²):</span>
              <span className="inline-block h-2 w-16 rounded-xs bg-gradient-to-r from-[#622dba] via-[#de4968] to-[#fcf498]" />
              <span>4 → 50+</span>
            </span>
          )}
          {colorMode === 'deviation' && (
            <span className="flex items-center gap-1.5">
              <span className="text-slate-400">Δd (Å):</span>
              <span className="inline-block h-2 w-16 rounded-xs bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500" />
              <span>0 → 4+</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
