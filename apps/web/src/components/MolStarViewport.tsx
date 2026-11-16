import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CompareStructuresResult } from '@synlexa/wasm-bridge';
import { Crosshair, Box, Camera, Compass } from 'lucide-react';
import { createPluginUI } from 'molstar/lib/mol-plugin-ui';
import type { PluginUIContext } from 'molstar/lib/mol-plugin-ui/context';
import { DefaultPluginUISpec } from 'molstar/lib/mol-plugin-ui/spec';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands';
import { StateTransforms } from 'molstar/lib/mol-plugin-state/transforms';
import { StructureElement, StructureProperties } from 'molstar/lib/mol-model/structure';
import { Mat4, Vec3 } from 'molstar/lib/mol-math/linear-algebra';
import { Color } from 'molstar/lib/mol-util/color';
import 'molstar/build/viewer/molstar.css';
import type { ColorMode } from '../lib/colorPalettes';
import { computeDockingBox, type DockingBoxSpec } from '../lib/dockingBox';
import type { CameraPreset, RenderStyle, ViewportLayout } from '../lib/workbenchReducers';
import type { MolecularViewportHandle } from './MolecularViewport';

export interface MolStarExtraOverlay {
  id: string;
  label: string;
  content: string;
  format: 'pdb' | 'mmcif' | 'sdf' | 'pdbqt' | 'mol';
}

interface MolStarViewportProps {
  refLabel: string;
  refContent: string;
  mobLabel: string;
  mobContent: string;
  comparison: CompareStructuresResult | null;
  layout: ViewportLayout;
  style: RenderStyle;
  colorMode: ColorMode;
  focusedSeqId: number | null;
  extraOverlay?: MolStarExtraOverlay | null;
  onPickResidue: (seqId: number) => void;
  onSendPocketToDocking?: (box: DockingBoxSpec) => void;
}

function detectFormat(label: string, content: string): 'mmcif' | 'pdb' {
  if (/\.pdb$/i.test(label) || /\.ent$/i.test(label)) return 'pdb';
  if (/\.cif$/i.test(label) || /\.mmcif$/i.test(label)) return 'mmcif';
  return content.trimStart().startsWith('data_') || content.includes('_atom_site.') ? 'mmcif' : 'pdb';
}

export const MolStarViewport = forwardRef<MolecularViewportHandle, MolStarViewportProps>(
  function MolStarViewport(
    {
      refLabel,
      refContent,
      mobLabel,
      mobContent,
      comparison,
      layout,
      style,
      colorMode,
      focusedSeqId,
      extraOverlay,
      onPickResidue,
      onSendPocketToDocking,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const pluginRef = useRef<PluginUIContext | null>(null);
    const reactRootRef = useRef<Root | null>(null);
    const [ready, setReady] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [molCount, setMolCount] = useState(0);

    const pocketBox = useMemo(
      () => computeDockingBox(comparison, focusedSeqId),
      [comparison, focusedSeqId],
    );

    const applyPreset = (preset: CameraPreset) => {
      const plugin = pluginRef.current;
      if (!plugin) return;
      if (preset === 'overview' || preset === 'reset') {
        void PluginCommands.Camera.Reset(plugin, { durationMs: 250 });
        return;
      }
      if (preset === 'active-site' && pocketBox) {
        const [x, y, z] = pocketBox.center;
        void PluginCommands.Camera.Focus(plugin, {
          center: Vec3.create(x, y, z),
          radius: 15,
          durationMs: 250,
        });
        return;
      }
      const residues = comparison?.refDisplayAtoms?.residues ?? [];
      if (preset === 'n-terminus' && residues.length > 0) {
        const [x, y, z] = residues[0].ca;
        void PluginCommands.Camera.Focus(plugin, {
          center: Vec3.create(x, y, z),
          radius: 16,
          durationMs: 250,
        });
      }
    };

    useImperativeHandle(
      ref,
      () => ({
        capturePngDataUrl: () => {
          const canvas = hostRef.current?.querySelector('canvas');
          if (!canvas) return null;
          try {
            return canvas.toDataURL('image/png');
          } catch {
            return null;
          }
        },
        applyPreset,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [pocketBox, comparison],
    );

    useEffect(() => {
      const target = hostRef.current;
      if (!target) return;
      let cancelled = false;
      let clickSub: { unsubscribe: () => void } | null = null;

      const init = async () => {
        try {
          const spec = DefaultPluginUISpec();
          spec.layout = {
            initial: {
              isExpanded: false,
              showControls: false,
              controlsDisplay: 'reactive',
            },
          };
          const plugin = await createPluginUI({
            target,
            spec,
            render: (el, container) => {
              if (!reactRootRef.current) {
                reactRootRef.current = createRoot(container);
              }
              reactRootRef.current.render(el);
            },
          });
          if (cancelled) {
            plugin.dispose();
            return;
          }
          pluginRef.current = plugin;

          await PluginCommands.Canvas3D.SetSettings(plugin, {
            settings: (old) => ({
              ...old,
              renderer: {
                ...old.renderer,
                backgroundColor: Color(0x070b12),
              },
            }),
          });

          clickSub = plugin.behaviors.interaction.click.subscribe((ev) => {
            if (StructureElement.Loci.is(ev.current.loci)) {
              const first = StructureElement.Loci.getFirstLocation(ev.current.loci);
              if (first) {
                const seqId = StructureProperties.residue.auth_seq_id(first);
                if (Number.isFinite(seqId) && seqId > 0) {
                  onPickResidue(seqId);
                }
              }
            }
          });
          setReady(true);
        } catch (err) {
          if (!cancelled) {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        }
      };

      void init();

      return () => {
        cancelled = true;
        clickSub?.unsubscribe();
        setReady(false);
        const plugin = pluginRef.current;
        pluginRef.current = null;
        plugin?.dispose();
        const r = reactRootRef.current;
        reactRootRef.current = null;
        setTimeout(() => r?.unmount(), 0);
      };
      // Mount Mol* once; structure changes reload cleanly in the effect below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const plugin = pluginRef.current;
      if (!ready || !plugin) return;
      let stale = false;

      const load = async () => {
        try {
          setLoadError(null);
          await plugin.clear();

          let loaded = 0;
          const reprType =
            style === 'pocket'
              ? 'molecular-surface'
              : style === 'trace'
                ? 'backbone'
                : 'cartoon';

          const colorTheme =
            colorMode === 'plddt' || colorMode === 'bfactor'
              ? ('uncertainty' as const)
              : colorMode === 'deviation'
                ? ('residue-name' as const)
                : ('chain-id' as const);

          const loadOne = async (
            content: string,
            label: string,
            format: 'mmcif' | 'pdb' | 'sdf' | 'pdbqt' | 'mol',
            matrixRowMajor?: number[],
            forceColor?: number,
          ) => {
            if (!content.trim()) return;
            const raw = await plugin.builders.data.rawData({ data: content, label });
            const traj = await plugin.builders.structure.parseTrajectory(raw, format);
            const model = await plugin.builders.structure.createModel(traj);
            let struct = await plugin.builders.structure.createStructure(model);

            if (matrixRowMajor && matrixRowMajor.length === 16) {
              const mat = Mat4.ofRows([
                [matrixRowMajor[0], matrixRowMajor[1], matrixRowMajor[2], matrixRowMajor[3]],
                [matrixRowMajor[4], matrixRowMajor[5], matrixRowMajor[6], matrixRowMajor[7]],
                [matrixRowMajor[8], matrixRowMajor[9], matrixRowMajor[10], matrixRowMajor[11]],
                [matrixRowMajor[12], matrixRowMajor[13], matrixRowMajor[14], matrixRowMajor[15]],
              ]);
              const update = plugin.build();
              struct = update
                .to(struct)
                .apply(StateTransforms.Model.TransformStructureConformation, {
                  transform: { name: 'matrix', params: { data: mat, transpose: false } },
                })
                .selector;
              await update.commit();
            }

            if (format === 'sdf' || format === 'pdbqt' || format === 'mol') {
              await plugin.builders.structure.representation.addRepresentation(struct, {
                type: 'ball-and-stick',
                color: 'element-symbol',
              });
            } else {
              const polymer = await plugin.builders.structure.tryCreateComponentStatic(struct, 'polymer');
              if (polymer) {
                await plugin.builders.structure.representation.addRepresentation(polymer, {
                  type: reprType,
                  color: forceColor !== undefined ? 'uniform' : colorTheme,
                  ...(forceColor !== undefined ? { colorParams: { value: Color(forceColor) } } : {}),
                });
              }
              const ligand = await plugin.builders.structure.tryCreateComponentStatic(struct, 'ligand');
              if (ligand) {
                await plugin.builders.structure.representation.addRepresentation(ligand, {
                  type: 'ball-and-stick',
                  color: 'element-symbol',
                });
              }
              const ion = await plugin.builders.structure.tryCreateComponentStatic(struct, 'ion');
              if (ion) {
                await plugin.builders.structure.representation.addRepresentation(ion, {
                  type: 'spacefill',
                  color: 'element-symbol',
                });
              }
            }
            loaded++;
          };

          if (refContent && layout !== 'mobile') {
            await loadOne(
              refContent,
              refLabel || 'Reference',
              detectFormat(refLabel, refContent),
              undefined,
              colorMode === 'identity' ? 0x38bdf8 : undefined,
            );
          }

          if (mobContent && layout !== 'reference') {
            await loadOne(
              mobContent,
              mobLabel || 'Mobile',
              detectFormat(mobLabel, mobContent),
              layout === 'overlay' ? comparison?.transform.matrixRowMajor4x4 : undefined,
              colorMode === 'identity' ? 0x34d399 : undefined,
            );
          }

          if (extraOverlay && extraOverlay.content.trim()) {
            await loadOne(extraOverlay.content, extraOverlay.label, extraOverlay.format);
          }

          if (!stale) {
            setMolCount(loaded);
            await PluginCommands.Camera.Reset(plugin, { durationMs: 200 });
          }
        } catch (err) {
          if (!stale) {
            setLoadError(err instanceof Error ? err.message : String(err));
          }
        }
      };

      void load();
      return () => {
        stale = true;
      };
    }, [ready, refLabel, refContent, mobLabel, mobContent, comparison, layout, style, colorMode, extraOverlay]);

    // Focus camera on selected residue if present in comparison residues.
    useEffect(() => {
      const plugin = pluginRef.current;
      if (!ready || !plugin || focusedSeqId === null || !comparison?.refDisplayAtoms) return;
      const res = comparison.refDisplayAtoms.residues.find((b) => b.seqId === focusedSeqId);
      if (!res) return;
      void PluginCommands.Camera.Focus(plugin, {
        center: Vec3.create(res.ca[0], res.ca[1], res.ca[2]),
        radius: 14,
        durationMs: 220,
      });
    }, [ready, focusedSeqId, comparison]);

    return (
      <div className="relative h-full w-full overflow-hidden bg-[#070b12]">
        <div ref={hostRef} className="msp-plugin h-full w-full" />

        {loadError && (
          <div className="pointer-events-auto absolute top-14 left-3 z-20 max-w-md rounded-lg border border-rose-500/40 bg-rose-950/90 px-3 py-2 text-xs text-rose-200">
            Mol* notice: {loadError}
          </div>
        )}

        {/* Bottom HUD */}
        <div className="pointer-events-none absolute right-2.5 bottom-2.5 left-2.5 z-10 flex flex-wrap items-center justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-[#0d121b]/85 p-1 shadow-xl backdrop-blur-md">
            <button
              type="button"
              onClick={() => applyPreset('overview')}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.07]"
            >
              <Compass className="h-3.5 w-3.5" /> Reset Camera
            </button>
            {pocketBox && (
              <button
                type="button"
                onClick={() => applyPreset('active-site')}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-200 hover:bg-white/[0.07]"
              >
                <Crosshair className="h-3.5 w-3.5 text-sky-400" /> Focus Pocket
              </button>
            )}
            {pocketBox && onSendPocketToDocking && (
              <button
                type="button"
                onClick={() => onSendPocketToDocking(pocketBox)}
                className="flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/15 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/25"
                title={`Center (${pocketBox.center.join(', ')}) · Size (${pocketBox.size.join(' × ')}) Å`}
              >
                <Box className="h-3.5 w-3.5" /> Stage Vina Box
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const canvas = hostRef.current?.querySelector('canvas');
                if (!canvas) return;
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = `synlexa-molstar-${Date.now()}.png`;
                a.click();
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-300 hover:bg-white/[0.07]"
            >
              <Camera className="h-3.5 w-3.5" /> PNG
            </button>
          </div>

          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d121b]/85 px-3 py-1 font-mono text-[0.75rem] text-slate-300 backdrop-blur-md">
            <span className="text-sky-300">Mol* 5 (MIT)</span>
            <span>·</span>
            <span>{molCount} model{molCount === 1 ? '' : 's'}</span>
            {pocketBox && (
              <>
                <span>·</span>
                <span className="text-slate-400">
                  Box [{pocketBox.center.join(', ')}] ({pocketBox.size.join('×')} Å)
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
);
