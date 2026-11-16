import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Atom,
  CheckCircle2,
  Clock,
  Database,
  Dna,
  ExternalLink,
  Fingerprint,
  FlaskConical,
  Globe,
  HardDrive,
  Layers,
  LoaderCircle,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  DB_SOURCE_LABELS,
  fetchAlphaFoldRecordForUniProt,
  importCompoundRecord,
  importStructureRecord,
  listOfflineCatalog,
  searchDatabase,
  type DbRecord,
  type DbSearchResult,
  type DbSource,
  type ImportedCompound,
  type ImportedStructure,
  type RecordOrigin,
} from '../lib/databaseConnector';

export interface DatabaseExplorerModalProps {
  open: boolean;
  onClose: () => void;
  onImportStructure: (
    structure: ImportedStructure,
    role: 'reference' | 'mobile',
  ) => void | Promise<void>;
  onImportCompound: (compound: ImportedCompound) => void;
  defaultSource?: DbSource;
}

interface ImportReceipt {
  kind: 'structure' | 'compound';
  label: string;
  roleLabel: string;
  sha256: string | null;
  paeSha256: string | null;
  retrievedAtUtc: string;
  origin: RecordOrigin;
  sourceUrl: string;
  license: string;
  warnings: string[];
}

const SOURCE_TABS: Array<{
  id: DbSource;
  label: string;
  hint: string;
  examples: string[];
}> = [
  {
    id: 'rcsb',
    label: 'RCSB PDB',
    hint: 'Experimental mmCIF structures (CC0-1.0)',
    examples: ['carbonic anhydrase', 'ubiquitin', '1A3N', '1LZ1'],
  },
  {
    id: 'alphafold',
    label: 'AlphaFold DB',
    hint: 'Predicted structures + PAE matrices (CC-BY-4.0)',
    examples: ['P00918', 'P0CG48', 'P68871', 'P61626'],
  },
  {
    id: 'uniprot',
    label: 'UniProtKB',
    hint: 'Protein accessions & annotations (CC-BY-4.0)',
    examples: ['carbonic anhydrase', 'ubiquitin', 'P68871', 'lysozyme'],
  },
  {
    id: 'pubchem',
    label: 'PubChem',
    hint: 'Small-molecule SMILES & properties (Public domain)',
    examples: ['imatinib', 'acetazolamide', 'aspirin', 'caffeine'],
  },
  {
    id: 'chembl',
    label: 'ChEMBL',
    hint: 'Bioactive ligands & clinical candidates (CC-BY-SA-3.0)',
    examples: ['acetazolamide', 'imatinib', 'dorzolamide'],
  },
  {
    id: 'opentargets',
    label: 'Open Targets',
    hint: 'Human target-disease associations (Apache-2.0)',
    examples: ['CA2', 'TPO', 'TSHR', 'TP53'],
  },
];

function SourceIcon({ source }: { source: DbSource }) {
  if (source === 'rcsb') return <Layers className="h-3.5 w-3.5" />;
  if (source === 'alphafold') return <Atom className="h-3.5 w-3.5" />;
  if (source === 'uniprot') return <Dna className="h-3.5 w-3.5" />;
  return <FlaskConical className="h-3.5 w-3.5" />;
}

function OriginBadge({ origin }: { origin: RecordOrigin }) {
  if (origin === 'live-network') {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[0.75rem] font-semibold tracking-wider text-emerald-300">
        <Globe className="h-2.5 w-2.5" />
        LIVE
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[0.75rem] font-semibold tracking-wider text-amber-300">
      <HardDrive className="h-2.5 w-2.5" />
      PINNED CACHE
    </span>
  );
}

export function DatabaseExplorerModal({
  open,
  onClose,
  onImportStructure,
  onImportCompound,
  defaultSource = 'rcsb',
}: DatabaseExplorerModalProps) {
  const [source, setSource] = useState<DbSource>(defaultSource);
  const [query, setQuery] = useState('');
  const [offlineMode, setOfflineMode] = useState<boolean>(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<DbSearchResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyRecordKey, setBusyRecordKey] = useState<string | null>(null);
  const [uniProtAfModels, setUniProtAfModels] = useState<Record<string, DbRecord[]>>({});
  const [receipt, setReceipt] = useState<ImportReceipt | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setSource(defaultSource);
      setErrorMsg(null);
    } else {
      abortRef.current?.abort();
    }
  }, [open, defaultSource]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const loadCatalog = useCallback(
    async (targetSource: DbSource) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSearching(true);
      setErrorMsg(null);
      try {
        const res = await listOfflineCatalog(targetSource, { signal: ctrl.signal });
        if (!ctrl.signal.aborted) {
          setSearchResult(res);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setSearching(false);
        }
      }
    },
    [],
  );

  // When offline mode is enabled and the user switches tabs (or opens offline), show pinned fixtures.
  useEffect(() => {
    if (open && offlineMode) {
      void loadCatalog(source);
    }
  }, [open, offlineMode, source, loadCatalog]);

  const runSearch = useCallback(
    async (targetSource: DbSource, rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) {
        if (offlineMode) {
          await loadCatalog(targetSource);
        } else {
          setErrorMsg(`Enter a search query or click an example chip for ${DB_SOURCE_LABELS[targetSource]}.`);
        }
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setSearching(true);
      setErrorMsg(null);

      try {
        const res = await searchDatabase(targetSource, trimmed, {
          offline: offlineMode,
          signal: ctrl.signal,
        });
        if (!ctrl.signal.aborted) {
          setSearchResult(res);
          setUniProtAfModels({});
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setSearching(false);
        }
      }
    },
    [offlineMode, loadCatalog],
  );

  const handleTabChange = (nextSource: DbSource) => {
    abortRef.current?.abort();
    setSource(nextSource);
    setErrorMsg(null);
    setUniProtAfModels({});
    if (!offlineMode) {
      setSearchResult(null);
    }
  };

  const handleImportStructure = async (record: DbRecord, role: 'reference' | 'mobile') => {
    const key = `${record.source}:${record.id}:${role}`;
    setBusyRecordKey(key);
    setErrorMsg(null);
    try {
      const imported = await importStructureRecord(record, { offline: offlineMode });
      await onImportStructure(imported, role);
      setReceipt({
        kind: 'structure',
        label: imported.label,
        roleLabel: role === 'reference' ? 'Reference Structure' : 'Mobile Structure',
        sha256: imported.sha256,
        paeSha256: imported.paeSha256,
        retrievedAtUtc: imported.retrievedAtUtc,
        origin: imported.origin,
        sourceUrl: imported.sourceUrl,
        license: imported.license,
        warnings: imported.warnings,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyRecordKey(null);
    }
  };

  const handleFetchUniProtAlphaFold = async (record: DbRecord) => {
    const key = `af-lookup:${record.id}`;
    setBusyRecordKey(key);
    setErrorMsg(null);
    try {
      const res = await fetchAlphaFoldRecordForUniProt(record.id, { offline: offlineMode });
      if (res.records.length === 0) {
        setErrorMsg(`No AlphaFold DB prediction found for UniProt accession ${record.id}.`);
      } else {
        setUniProtAfModels((prev) => ({ ...prev, [record.id]: res.records }));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyRecordKey(null);
    }
  };

  const handleAnalyzeCompound = (record: DbRecord) => {
    setErrorMsg(null);
    try {
      const imported = importCompoundRecord(record);
      onImportCompound(imported);
      setReceipt({
        kind: 'compound',
        label: imported.name,
        roleLabel: imported.cid !== null ? `PubChem CID ${imported.cid}` : 'Small Molecule',
        sha256: null,
        paeSha256: null,
        retrievedAtUtc: imported.retrievedAtUtc,
        origin: imported.origin,
        sourceUrl: imported.sourceUrl,
        license: imported.license,
        warnings: [],
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  if (!open) return null;

  const activeTab = SOURCE_TABS.find((t) => t.id === source) ?? SOURCE_TABS[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Public Database Explorer"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0b1019] text-slate-100 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-slate-100">
                Public Database Explorer
              </h2>
              <p className="text-[0.8125rem] text-slate-400">
                Direct browser fetch with SHA-256 provenance &amp; pinned local fixture fallback
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOfflineMode((v) => !v)}
              aria-pressed={offlineMode}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[0.8125rem] transition-colors ${
                offlineMode
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-slate-700 bg-slate-900/80 text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200'
              }`}
              title="Toggle between live public API requests and pinned local cache (/fixtures/)"
            >
              {offlineMode ? (
                <>
                  <HardDrive className="h-3.5 w-3.5" />
                  <span>Offline: Pinned Cache</span>
                </>
              ) : (
                <>
                  <Globe className="h-3.5 w-3.5 text-cyan-400" />
                  <span>Network: Live API</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close database explorer"
              className="rounded-md border border-slate-800 bg-slate-900/80 p-1.5 text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Source Tabs */}
        <div className="grid grid-cols-2 gap-1.5 border-b border-slate-800 bg-[#090d15] px-4 py-2 sm:grid-cols-4">
          {SOURCE_TABS.map((tab) => {
            const active = tab.id === source;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-200'
                    : 'border-slate-800/90 bg-slate-900/50 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <span className={active ? 'text-cyan-400' : 'text-slate-500'}>
                  <SourceIcon source={tab.id} />
                </span>
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Input + Example Chips */}
        <div className="border-b border-slate-800 bg-[#0d131f]/70 px-4 py-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(source, query);
            }}
          >
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700/80 bg-[#0b1019] px-3 py-2 focus-within:border-cyan-500/60">
              <Search className="h-4 w-4 shrink-0 text-cyan-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${activeTab.label} (${activeTab.examples.slice(0, 2).join(', ')})…`}
                className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={searching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-cyan-500/15 px-3.5 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
            >
              {searching ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              <span>Search</span>
            </button>

            <button
              type="button"
              onClick={() => void loadCatalog(source)}
              disabled={searching}
              className="hidden rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-[0.8125rem] text-slate-300 transition-colors hover:border-slate-600 hover:text-slate-100 sm:inline-flex"
              title="Browse curated local pinned fixtures for this source"
            >
              Pinned Fixtures
            </button>
          </form>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[0.75rem] font-medium uppercase tracking-wider text-slate-500">
                Examples:
              </span>
              {activeTab.examples.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    setQuery(chip);
                    void runSearch(source, chip);
                  }}
                  className="rounded-full border border-slate-700/80 bg-slate-900/70 px-2.5 py-0.5 font-mono text-[0.75rem] text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-200"
                >
                  {chip}
                </button>
              ))}
            </div>
            <span className="text-[0.75rem] text-slate-500">{activeTab.hint}</span>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* Post-Import Provenance Receipt */}
          {receipt && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 font-medium text-emerald-200">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>
                    Imported {receipt.label} ({receipt.roleLabel})
                  </span>
                </div>
                <OriginBadge origin={receipt.origin} />
              </div>

              <div className="mt-2 grid gap-1.5 font-mono text-[0.75rem] text-slate-300 sm:grid-cols-2">
                {receipt.sha256 && (
                  <div className="flex items-center gap-1.5 break-all">
                    <Fingerprint className="h-3 w-3 shrink-0 text-emerald-400" />
                    <span>
                      <strong className="text-slate-400">SHA-256:</strong> {receipt.sha256}
                    </span>
                  </div>
                )}
                {receipt.paeSha256 && (
                  <div className="flex items-center gap-1.5 break-all">
                    <Fingerprint className="h-3 w-3 shrink-0 text-cyan-400" />
                    <span>
                      <strong className="text-slate-400">PAE SHA-256:</strong> {receipt.paeSha256}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3 shrink-0 text-slate-400" />
                  <span>
                    <strong className="text-slate-400">Retrieved UTC:</strong>{' '}
                    {receipt.retrievedAtUtc}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3 w-3 shrink-0 text-slate-400" />
                  <span>
                    <strong className="text-slate-400">License:</strong> {receipt.license}
                  </span>
                </div>
              </div>

              {receipt.warnings.length > 0 && (
                <p className="mt-1.5 text-[0.8125rem] text-amber-300">
                  {receipt.warnings.join(' ')}
                </p>
              )}
            </div>
          )}

          {/* Fallback / Rate-Limit Warning */}
          {searchResult?.warning && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>{searchResult.warning}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Empty / Initial State */}
          {!searching && !searchResult && (
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/30 px-4 py-8 text-center">
              <p className="text-xs text-slate-300">
                Search {activeTab.label} above or choose an example chip to fetch verified records.
              </p>
              <p className="mt-1 text-[0.8125rem] text-slate-500">
                Rate-limited or offline requests automatically fall back to the pinned local fixture
                cache with explicit provenance badges.
              </p>
            </div>
          )}

          {!searching && searchResult && searchResult.records.length === 0 && (
            <div className="rounded-lg border border-slate-800/80 bg-slate-900/30 px-4 py-8 text-center text-xs text-slate-400">
              No records returned from {DB_SOURCE_LABELS[source]} for &ldquo;{query}&rdquo;.
            </div>
          )}

          {/* Result Cards */}
          {searchResult &&
            searchResult.records.map((record) => {
              const linkedAf = uniProtAfModels[record.id];
              const isBusyRef = busyRecordKey === `${record.source}:${record.id}:reference`;
              const isBusyMob = busyRecordKey === `${record.source}:${record.id}:mobile`;
              const isBusyAf = busyRecordKey === `af-lookup:${record.id}`;

              return (
                <div
                  key={`${record.source}-${record.id}-${record.origin}`}
                  className="rounded-lg border border-slate-800 bg-[#0e1522]/90 p-3 transition-colors hover:border-slate-700"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[0.8125rem] font-semibold text-cyan-300">
                          {record.id}
                        </span>
                        <OriginBadge origin={record.origin} />
                        <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[0.75rem] text-slate-300">
                          {record.license}
                        </span>
                        {record.uniprotAccession && record.source !== 'uniprot' && (
                          <span className="font-mono text-[0.75rem] text-slate-400">
                            UniProt {record.uniprotAccession}
                          </span>
                        )}
                      </div>

                      <h3 className="mt-1.5 text-xs font-medium text-slate-100">
                        {record.title}
                      </h3>

                      {record.subtitle && (
                        <p className="mt-0.5 text-[0.8125rem] text-slate-400">{record.subtitle}</p>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.75rem] text-slate-400">
                        {record.organism && <span>Organism: {record.organism}</span>}
                        {record.length !== null && record.length !== undefined && (
                          <span>Length: {record.length} aa</span>
                        )}
                        {record.formula && <span>Formula: {record.formula}</span>}
                        {record.molecularWeight !== null &&
                          record.molecularWeight !== undefined && (
                            <span>MW: {record.molecularWeight.toFixed(2)} g/mol</span>
                          )}
                        <span>UTC: {record.retrievedAtUtc}</span>
                        <a
                          href={record.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 hover:underline"
                        >
                          <span className="max-w-[260px] truncate">{record.sourceUrl}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      </div>

                      {record.smiles && (
                        <div className="mt-1.5 truncate rounded border border-slate-800 bg-[#090d15] px-2 py-1 font-mono text-[0.75rem] text-slate-300">
                          SMILES: {record.smiles}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {(record.source === 'rcsb' || record.source === 'alphafold') && (
                        <>
                          <button
                            type="button"
                            disabled={busyRecordKey !== null}
                            onClick={() => void handleImportStructure(record, 'reference')}
                            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[0.8125rem] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                          >
                            {isBusyRef && <LoaderCircle className="h-3 w-3 animate-spin" />}
                            <span>Import as Reference</span>
                          </button>
                          <button
                            type="button"
                            disabled={busyRecordKey !== null}
                            onClick={() => void handleImportStructure(record, 'mobile')}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/90 px-2.5 py-1.5 text-[0.8125rem] font-medium text-slate-200 transition-colors hover:border-cyan-500/40 hover:text-cyan-200 disabled:opacity-50"
                          >
                            {isBusyMob && <LoaderCircle className="h-3 w-3 animate-spin" />}
                            <span>Import as Mobile</span>
                          </button>
                        </>
                      )}

                      {record.source === 'uniprot' && (
                        <button
                          type="button"
                          disabled={busyRecordKey !== null}
                          onClick={() => void handleFetchUniProtAlphaFold(record)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[0.8125rem] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
                        >
                          {isBusyAf ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : (
                            <Atom className="h-3 w-3" />
                          )}
                          <span>Fetch AlphaFold model</span>
                        </button>
                      )}

                      {(record.source === 'pubchem' || record.source === 'chembl') && (
                        <button
                          type="button"
                          disabled={!record.smiles || busyRecordKey !== null}
                          onClick={() => handleAnalyzeCompound(record)}
                          title={
                            record.smiles
                              ? 'Load SMILES into Chemistry Workbench'
                              : 'SMILES unavailable in offline CID-only fallback'
                          }
                          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[0.8125rem] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <FlaskConical className="h-3 w-3" />
                          <span>Analyze SMILES</span>
                        </button>
                      )}

                      {record.source === 'opentargets' && (
                        <button
                          type="button"
                          onClick={() => {
                            setSource('uniprot');
                            setQuery(record.title);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1.5 text-[0.8125rem] font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
                        >
                          <Dna className="h-3 w-3" />
                          <span>Lookup UniProt</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline AlphaFold DB model resolved from UniProtKB row */}
                  {linkedAf && linkedAf.length > 0 && (
                    <div className="mt-2.5 space-y-2 border-t border-slate-800/80 pt-2.5">
                      {linkedAf.map((af) => (
                        <div
                          key={`${af.id}-${af.origin}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-cyan-500/25 bg-cyan-500/5 px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[0.8125rem] font-semibold text-cyan-300">
                                {af.id}
                              </span>
                              <OriginBadge origin={af.origin} />
                              {af.dataRevision && (
                                <span className="font-mono text-[0.75rem] text-slate-400">
                                  {af.dataRevision}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[0.8125rem] text-slate-300">
                              {af.title}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              disabled={busyRecordKey !== null}
                              onClick={() => void handleImportStructure(af, 'reference')}
                              className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[0.8125rem] font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
                            >
                              Import as Reference
                            </button>
                            <button
                              type="button"
                              disabled={busyRecordKey !== null}
                              onClick={() => void handleImportStructure(af, 'mobile')}
                              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[0.8125rem] font-medium text-slate-200 hover:border-cyan-500/40 hover:text-cyan-200 disabled:opacity-50"
                            >
                              Import as Mobile
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
        </div>

        {/* RUO Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 bg-[#090d15] px-4 py-2 text-[0.75rem] text-slate-400">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span>
              <strong className="text-amber-300">RESEARCH USE ONLY (RUO):</strong> External records
              carry verbatim source URLs, licenses, UTC timestamps, and SHA-256 digests. Not for
              clinical diagnosis or treatment.
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[0.8125rem] text-slate-300 hover:border-slate-600 hover:text-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
