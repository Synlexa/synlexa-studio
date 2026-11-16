#!/usr/bin/env node
/**
 * Synlexa Studio — Native vs. WebAssembly Parity & Latency Benchmark Suite
 *
 * Verifies:
 *   1. Wasm ABI v1 compliance (`abi_version`, `alloc`, `dealloc`, `invoke_json`, `last_result_len`, `extract_ca_coords_f64`)
 *   2. Cryptographic SHA-256 parity across `tests/fixtures/` and `apps/web/public/fixtures/` vs `fixtures-manifest.json`
 *   3. Bit-exact / <= 1e-6 A parity between native `studio-cli` and `synlexa_bio_core.wasm`:
 *      - `3HS4.cif` (Chain A) vs `AF-P00918-F1-model_v6.cif` (Chain A) + PAE JSON
 *      - `3HS4.pdb` (Chain A) vs `AF-P00918-F1-model_v6.pdb` (Chain A)
 *      - `1UBQ.cif` (Chain A) vs `AF-P0CG48-F1-model_v6.cif` (Chain A)
 *      - `1A3N.cif` (Chain B) vs `AF-P68871-F1-model_v6.cif` (Chain A)
 *      - `1LZ1.cif` (Chain A) vs `AF-P61626-F1-model_v6.cif` (Chain A)
 *      - Synthetic rigid-body rotation/translation transform (recovered RMSD < 1e-6 A)
 *   4. Native-vs-Wasm parity & PubChem reference formula/MW verification across 6 compounds
 *      (`Acetazolamide`, `Dorzolamide`, `Imatinib`, `Aspirin`, `Caffeine`, `Metformin`)
 *   5. Domain smoke checks on Wasm `analyze_peptide`, `analyze_gene_crispr`, `extract_ca_coords_f64`
 *   6. Latency p50 / p95 / mean / min / max for Wasm in-process and Native CLI subprocess
 *
 * Usage:
 *   node benchmarks/run_benchmarks.mjs [--iterations 15] [--cli-iterations 10] [--json]
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const WASM_PATH = path.join(ROOT, "apps/web/public/wasm/synlexa_bio_core.wasm");
const FIXTURES_DIR = path.join(ROOT, "tests/fixtures");
const WEB_FIXTURES_DIR = path.join(ROOT, "apps/web/public/fixtures");
const PARITY_TOLERANCE_A = 1e-6;
const PUBCHEM_MW_TOLERANCE_DA = 0.15;

const PUBCHEM_CID_LABELS = new Map([
  [1986, "Acetazolamide"],
  [3154, "Dorzolamide"],
  [5291, "Imatinib"],
  [2244, "Aspirin"],
  [2519, "Caffeine"],
  [4091, "Metformin"],
]);

function parseArgs(argv) {
  const opts = {
    wasmIterations: 15,
    cliIterations: 10,
    jsonOnly: false,
    nativeBin: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--iterations" && argv[i + 1]) {
      opts.wasmIterations = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (a === "--cli-iterations" && argv[i + 1]) {
      opts.cliIterations = Math.max(1, Number.parseInt(argv[++i], 10));
    } else if (a === "--native-bin" && argv[i + 1]) {
      opts.nativeBin = path.resolve(argv[++i]);
    } else if (a === "--json") {
      opts.jsonOnly = true;
    }
  }
  return opts;
}

function resolveNativeCli(explicitPath) {
  if (explicitPath && fs.existsSync(explicitPath)) {
    return explicitPath;
  }
  const releaseBin = path.join(ROOT, "target/release/studio-cli");
  if (fs.existsSync(releaseBin)) {
    return releaseBin;
  }
  const debugBin = path.join(ROOT, "target/debug/studio-cli");
  if (fs.existsSync(debugBin)) {
    return debugBin;
  }
  const env = {
    ...process.env,
    PATH: `${path.join(os.homedir(), ".cargo/bin")}:${process.env.PATH || ""}`,
  };
  const res = spawnSync("cargo", ["build", "--release", "-p", "studio-cli"], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });
  if (res.status !== 0 || !fs.existsSync(releaseBin)) {
    throw new Error("Failed to locate or build native studio-cli binary");
  }
  return releaseBin;
}

async function loadWasmEngine(wasmPath) {
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`Missing Wasm artifact at ${wasmPath}`);
  }
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = instance.exports;

  for (const fn of [
    "memory",
    "alloc",
    "dealloc",
    "abi_version",
    "last_result_len",
    "invoke_json",
  ]) {
    if (!(fn in exports)) {
      throw new Error(`Wasm export missing required symbol: ${fn}`);
    }
  }

  const abiVersion = exports.abi_version();
  if (abiVersion !== 1) {
    throw new Error(`Unexpected Wasm abi_version: ${abiVersion} (expected 1)`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");

  function invokeJson(op, payload) {
    const reqBytes = encoder.encode(JSON.stringify({ op, payload }));
    const reqPtr = exports.alloc(reqBytes.length);
    try {
      new Uint8Array(exports.memory.buffer, reqPtr, reqBytes.length).set(reqBytes);
      const resPtr = exports.invoke_json(reqPtr, reqBytes.length);
      const resLen = exports.last_result_len();
      const resSlice = new Uint8Array(exports.memory.buffer, resPtr, resLen);
      const parsed = JSON.parse(decoder.decode(resSlice));
      if (!parsed.ok) {
        const msg = parsed.error ? `${parsed.error.code}: ${parsed.error.message}` : "Unknown Wasm error";
        throw new Error(`Wasm op '${op}' failed: ${msg}`);
      }
      return parsed.data;
    } finally {
      exports.dealloc(reqPtr, reqBytes.length);
    }
  }

  function extractCaCoordsF64(content, chainId, maxAtoms = 5000) {
    if (typeof exports.extract_ca_coords_f64 !== "function") {
      return null;
    }
    const reqBytes = encoder.encode(JSON.stringify({ content, chainId }));
    const reqPtr = exports.alloc(reqBytes.length);
    const outByteLen = maxAtoms * 4 * 8;
    const outPtr = exports.alloc(outByteLen);
    try {
      new Uint8Array(exports.memory.buffer, reqPtr, reqBytes.length).set(reqBytes);
      const count = exports.extract_ca_coords_f64(reqPtr, reqBytes.length, outPtr, maxAtoms);
      const f64 = new Float64Array(exports.memory.buffer, outPtr, count * 4);
      return Array.from(f64);
    } finally {
      exports.dealloc(reqPtr, reqBytes.length);
      exports.dealloc(outPtr, outByteLen);
    }
  }

  return { abiVersion, wasmBytes: bytes.length, invokeJson, extractCaCoordsF64 };
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function verifyFixtureManifestMirror(manifest) {
  const checked = [];
  for (const entry of manifest.fixtures) {
    const testFile = path.join(FIXTURES_DIR, entry.fileName);
    const webFile = path.join(WEB_FIXTURES_DIR, entry.fileName);
    if (!fs.existsSync(testFile)) {
      throw new Error(`Missing fixture in tests/fixtures/: ${entry.fileName}`);
    }
    if (!fs.existsSync(webFile)) {
      throw new Error(`Missing fixture mirror in apps/web/public/fixtures/: ${entry.fileName}`);
    }
    const testSha = sha256File(testFile);
    const webSha = sha256File(webFile);
    if (testSha !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for tests/fixtures/${entry.fileName}: ${testSha} !== ${entry.sha256}`);
    }
    if (webSha !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for apps/web/public/fixtures/${entry.fileName}: ${webSha} !== ${entry.sha256}`);
    }
    checked.push({ id: entry.id, fileName: entry.fileName, sha256: entry.sha256 });
  }
  return checked;
}

function runNativeCompare(nativeBin, { refPath, refChain, mobPath, mobChain, paePath, outPath }) {
  const args = [
    "compare",
    "--ref",
    refPath,
    "--ref-chain",
    refChain,
    "--mob",
    mobPath,
    "--mob-chain",
    mobChain,
    "--out",
    outPath,
  ];
  if (paePath) {
    args.push("--pae", paePath);
  }
  execFileSync(nativeBin, args, { cwd: ROOT, stdio: "pipe" });
  return JSON.parse(fs.readFileSync(outPath, "utf8"));
}

function runNativeSmiles(nativeBin, { name, smiles }) {
  const stdout = execFileSync(
    nativeBin,
    ["smiles", "--name", name, "--smiles", smiles],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(stdout);
}

function runNativeRamachandran(nativeBin, { inputPath, chainId, outPath }) {
  const args = ["ramachandran", "--input", inputPath, "--out", outPath];
  if (chainId) {
    args.push("--chain", chainId);
  }
  execFileSync(nativeBin, args, { cwd: ROOT, stdio: "pipe" });
  return JSON.parse(fs.readFileSync(outPath, "utf8"));
}

function assertRamachandranParity(label, nativeRes, wasmRes, tol = PARITY_TOLERANCE_A) {
  const diffs = [];
  if (nativeRes.residueCount !== wasmRes.residueCount) {
    diffs.push(`residueCount native=${nativeRes.residueCount} vs wasm=${wasmRes.residueCount}`);
  }
  if (nativeRes.chainId !== wasmRes.chainId) {
    diffs.push(`chainId native=${nativeRes.chainId} vs wasm=${wasmRes.chainId}`);
  }
  for (const k of ["helix", "sheet", "loop"]) {
    if (nativeRes.secondaryCounts?.[k] !== wasmRes.secondaryCounts?.[k]) {
      diffs.push(`secondaryCounts.${k} native=${nativeRes.secondaryCounts?.[k]} vs wasm=${wasmRes.secondaryCounts?.[k]}`);
    }
  }
  for (const k of ["favored", "allowed", "outlier"]) {
    if (nativeRes.regionCounts?.[k] !== wasmRes.regionCounts?.[k]) {
      diffs.push(`regionCounts.${k} native=${nativeRes.regionCounts?.[k]} vs wasm=${wasmRes.regionCounts?.[k]}`);
    }
  }
  let maxAngleDiff = 0;
  const natRes = nativeRes.residues || [];
  const wasmR = wasmRes.residues || [];
  if (natRes.length !== wasmR.length) {
    diffs.push(`residues length ${natRes.length} vs ${wasmR.length}`);
  } else {
    for (let i = 0; i < natRes.length; i++) {
      const a = natRes[i];
      const b = wasmR[i];
      if (a.seqId !== b.seqId || a.secondary !== b.secondary || a.region !== b.region) {
        diffs.push(`residue ${i} mismatch (${a.seqId}/${a.secondary}/${a.region} vs ${b.seqId}/${b.secondary}/${b.region})`);
        break;
      }
      if ((a.phiDeg === null) !== (b.phiDeg === null) || (a.psiDeg === null) !== (b.psiDeg === null)) {
        diffs.push(`residue ${a.seqId} dihedral nullness mismatch`);
        break;
      }
      if (a.phiDeg !== null) {
        maxAngleDiff = Math.max(maxAngleDiff, Math.abs(a.phiDeg - b.phiDeg));
      }
      if (a.psiDeg !== null) {
        maxAngleDiff = Math.max(maxAngleDiff, Math.abs(a.psiDeg - b.psiDeg));
      }
    }
  }
  if (maxAngleDiff > tol) {
    diffs.push(`max dihedral angle diff ${maxAngleDiff.toExponential(3)} > ${tol}`);
  }
  const natContacts = nativeRes.contactPairs || [];
  const wasmContacts = wasmRes.contactPairs || [];
  let maxContactDiff = 0;
  if (natContacts.length !== wasmContacts.length) {
    diffs.push(`contactPairs length ${natContacts.length} vs ${wasmContacts.length}`);
  } else {
    for (let i = 0; i < natContacts.length; i++) {
      if (natContacts[i][0] !== wasmContacts[i][0] || natContacts[i][1] !== wasmContacts[i][1]) {
        diffs.push(`contactPair ${i} indices mismatch`);
        break;
      }
      maxContactDiff = Math.max(maxContactDiff, Math.abs(natContacts[i][2] - wasmContacts[i][2]));
    }
  }
  if (maxContactDiff > tol) {
    diffs.push(`max contact distance diff ${maxContactDiff.toExponential(3)} > ${tol}`);
  }
  if (diffs.length > 0) {
    throw new Error(`[Ramachandran ${label}] Native vs Wasm parity FAILED:\n  - ${diffs.join("\n  - ")}`);
  }
  return {
    label,
    chainId: nativeRes.chainId,
    residueCount: nativeRes.residueCount,
    secondaryCounts: nativeRes.secondaryCounts,
    regionCounts: nativeRes.regionCounts,
    contactPairCount: natContacts.length,
    maxAngleDiff,
    maxContactDiff,
  };
}

function assertParity(label, nativeRes, wasmRes, tol = PARITY_TOLERANCE_A) {
  const diffs = [];

  if (nativeRes.metrics.matchedCaCount !== wasmRes.metrics.matchedCaCount) {
    diffs.push(
      `matchedCaCount mismatch: native=${nativeRes.metrics.matchedCaCount}, wasm=${wasmRes.metrics.matchedCaCount}`
    );
  }
  if (nativeRes.metrics.paeStatus !== wasmRes.metrics.paeStatus) {
    diffs.push(
      `paeStatus mismatch: native=${nativeRes.metrics.paeStatus}, wasm=${wasmRes.metrics.paeStatus}`
    );
  }
  if (nativeRes.reference.sha256 !== wasmRes.reference.sha256) {
    diffs.push("reference.sha256 mismatch");
  }
  if (nativeRes.mobile.sha256 !== wasmRes.mobile.sha256) {
    diffs.push("mobile.sha256 mismatch");
  }
  if (nativeRes.reference.confidenceKind !== wasmRes.reference.confidenceKind) {
    diffs.push("reference.confidenceKind mismatch");
  }
  if (nativeRes.mobile.confidenceKind !== wasmRes.mobile.confidenceKind) {
    diffs.push("mobile.confidenceKind mismatch");
  }
  if (
    nativeRes.metrics.refCoverage.numerator !== wasmRes.metrics.refCoverage.numerator ||
    nativeRes.metrics.refCoverage.denominator !== wasmRes.metrics.refCoverage.denominator ||
    nativeRes.metrics.refCoverage.denominatorKind !== wasmRes.metrics.refCoverage.denominatorKind
  ) {
    diffs.push("refCoverage mismatch");
  }
  if (
    nativeRes.metrics.mobCoverage.numerator !== wasmRes.metrics.mobCoverage.numerator ||
    nativeRes.metrics.mobCoverage.denominator !== wasmRes.metrics.mobCoverage.denominator ||
    nativeRes.metrics.mobCoverage.denominatorKind !== wasmRes.metrics.mobCoverage.denominatorKind
  ) {
    diffs.push("mobCoverage mismatch");
  }

  const rmsdDiff = Math.abs(nativeRes.metrics.rmsdAngstrom - wasmRes.metrics.rmsdAngstrom);
  if (rmsdDiff > tol) {
    diffs.push(
      `rmsdAngstrom diff ${rmsdDiff.toExponential(3)} > ${tol} (native=${nativeRes.metrics.rmsdAngstrom}, wasm=${wasmRes.metrics.rmsdAngstrom})`
    );
  }

  let maxMatrixDiff = 0;
  for (let i = 0; i < 16; i++) {
    const d = Math.abs(
      nativeRes.transform.matrixRowMajor4x4[i] - wasmRes.transform.matrixRowMajor4x4[i]
    );
    if (d > maxMatrixDiff) maxMatrixDiff = d;
  }
  if (maxMatrixDiff > tol) {
    diffs.push(`matrixRowMajor4x4 max diff ${maxMatrixDiff.toExponential(3)} > ${tol}`);
  }

  const natResidues = nativeRes.matchedResidues || [];
  const wasmResidues = wasmRes.matchedResidues || [];
  let maxResDistDiff = 0;
  if (natResidues.length !== wasmResidues.length) {
    diffs.push(`matchedResidues length mismatch: ${natResidues.length} vs ${wasmResidues.length}`);
  } else {
    for (let i = 0; i < natResidues.length; i++) {
      if (
        natResidues[i].refSeqId !== wasmResidues[i].refSeqId ||
        natResidues[i].mobSeqId !== wasmResidues[i].mobSeqId
      ) {
        diffs.push(`residue index ${i} seqId mismatch`);
        break;
      }
      const d = Math.abs(natResidues[i].distanceAngstrom - wasmResidues[i].distanceAngstrom);
      if (d > maxResDistDiff) maxResDistDiff = d;
    }
    if (maxResDistDiff > tol) {
      diffs.push(`matchedResidues distanceAngstrom max diff ${maxResDistDiff.toExponential(3)} > ${tol}`);
    }
  }

  if (diffs.length > 0) {
    throw new Error(`[${label}] Native vs Wasm parity FAILED:\n  - ${diffs.join("\n  - ")}`);
  }

  return {
    label,
    matchedCaCount: nativeRes.metrics.matchedCaCount,
    rmsdAngstrom: nativeRes.metrics.rmsdAngstrom,
    rmsdDiff,
    maxMatrixDiff,
    maxResDistDiff,
    paeStatus: nativeRes.metrics.paeStatus,
    refCoverage: `${nativeRes.metrics.refCoverage.numerator}/${nativeRes.metrics.refCoverage.denominator} (${nativeRes.metrics.refCoverage.denominatorKind})`,
    mobCoverage: `${nativeRes.metrics.mobCoverage.numerator}/${nativeRes.metrics.mobCoverage.denominator} (${nativeRes.metrics.mobCoverage.denominatorKind})`,
  };
}

function assertSmilesParity(name, pubchemRow, nativeRes, wasmRes) {
  const diffs = [];
  if (nativeRes.formula !== wasmRes.formula) {
    diffs.push(`formula native=${nativeRes.formula} vs wasm=${wasmRes.formula}`);
  }
  if (nativeRes.formula !== pubchemRow.MolecularFormula) {
    diffs.push(`formula core=${nativeRes.formula} vs PubChem=${pubchemRow.MolecularFormula}`);
  }
  const pubchemMw = Number(pubchemRow.MolecularWeight);
  const mwNativeVsWasm = Math.abs(nativeRes.molecularWeight - wasmRes.molecularWeight);
  if (mwNativeVsWasm > PARITY_TOLERANCE_A) {
    diffs.push(`MW native vs wasm diff ${mwNativeVsWasm}`);
  }
  const mwVsPubchem = Math.abs(nativeRes.molecularWeight - pubchemMw);
  if (mwVsPubchem > PUBCHEM_MW_TOLERANCE_DA) {
    diffs.push(`MW core=${nativeRes.molecularWeight} vs PubChem=${pubchemMw} (diff ${mwVsPubchem.toFixed(4)} Da)`);
  }
  for (const key of ["heavyAtomCount", "ringCount", "hbd", "hba", "rotatableBonds"]) {
    if (nativeRes[key] !== wasmRes[key]) {
      diffs.push(`${key} native=${nativeRes[key]} vs wasm=${wasmRes[key]}`);
    }
  }
  if (Math.abs(nativeRes.tpsa - wasmRes.tpsa) > PARITY_TOLERANCE_A) {
    diffs.push(`tpsa native=${nativeRes.tpsa} vs wasm=${wasmRes.tpsa}`);
  }
  if (diffs.length > 0) {
    throw new Error(`[SMILES ${name} (CID ${pubchemRow.CID})] Parity FAILED:\n  - ${diffs.join("\n  - ")}`);
  }
  return {
    cid: pubchemRow.CID,
    name,
    formula: nativeRes.formula,
    pubchemFormula: pubchemRow.MolecularFormula,
    coreMwDa: nativeRes.molecularWeight,
    pubchemMwDa: pubchemMw,
    mwDeltaDa: Number(mwVsPubchem.toFixed(4)),
    nativeVsWasmMwDelta: mwNativeVsWasm,
    tpsaA2: nativeRes.tpsa,
    hbd: nativeRes.hbd,
    hba: nativeRes.hba,
    rotatableBonds: nativeRes.rotatableBonds,
  };
}

function buildSyntheticMmcif(coords, compIds) {
  const lines = [
    "data_synthetic",
    "loop_",
    "_atom_site.group_PDB",
    "_atom_site.id",
    "_atom_site.type_symbol",
    "_atom_site.label_atom_id",
    "_atom_site.label_alt_id",
    "_atom_site.label_comp_id",
    "_atom_site.label_asym_id",
    "_atom_site.label_entity_id",
    "_atom_site.label_seq_id",
    "_atom_site.pdbx_PDB_ins_code",
    "_atom_site.Cartn_x",
    "_atom_site.Cartn_y",
    "_atom_site.Cartn_z",
    "_atom_site.occupancy",
    "_atom_site.B_iso_or_equiv",
    "_atom_site.auth_seq_id",
    "_atom_site.auth_comp_id",
    "_atom_site.auth_asym_id",
    "_atom_site.pdbx_PDB_model_num",
  ];
  for (let i = 0; i < coords.length; i++) {
    const [x, y, z] = coords[i];
    const seqId = i + 1;
    const comp = compIds[i];
    lines.push(
      `ATOM ${seqId} C CA . ${comp} A 1 ${seqId} ? ${x.toFixed(8)} ${y.toFixed(8)} ${z.toFixed(8)} 1.00 12.50 ${seqId} ${comp} A 1`
    );
  }
  return `${lines.join("\n")}\n`;
}

function generateSyntheticRigidTest() {
  const residues = ["ALA", "GLY", "VAL", "LEU", "SER", "HIS", "PHE", "TYR", "TRP", "LYS"];
  const n = 40;
  const refCoords = [];
  const compIds = [];
  for (let i = 0; i < n; i++) {
    const t = i * 0.45;
    refCoords.push([
      2.3 * Math.cos(t) + 0.15 * i,
      2.3 * Math.sin(t) - 0.08 * i,
      1.5 * i + 0.4 * Math.sin(2 * t),
    ]);
    compIds.push(residues[i % residues.length]);
  }

  const theta = (42 * Math.PI) / 180;
  const ax = 1 / Math.sqrt(6);
  const ay = 2 / Math.sqrt(6);
  const az = -1 / Math.sqrt(6);
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const u = 1 - c;
  const R = [
    [c + ax * ax * u, ax * ay * u - az * s, ax * az * u + ay * s],
    [ay * ax * u + az * s, c + ay * ay * u, ay * az * u - ax * s],
    [az * ax * u - ay * s, az * ay * u + ax * s, c + az * az * u],
  ];
  const tVec = [14.25, -7.8, 31.125];

  const mobCoords = refCoords.map(([x, y, z]) => [
    R[0][0] * x + R[0][1] * y + R[0][2] * z + tVec[0],
    R[1][0] * x + R[1][1] * y + R[1][2] * z + tVec[1],
    R[2][0] * x + R[2][1] * y + R[2][2] * z + tVec[2],
  ]);

  return {
    refCif: buildSyntheticMmcif(refCoords, compIds),
    mobCif: buildSyntheticMmcif(mobCoords, compIds),
    refCoords,
    mobCoords,
  };
}

function summarizeTimings(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const quantile = (q) => {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  };
  const mean = sorted.reduce((acc, v) => acc + v, 0) / sorted.length;
  return {
    n: sorted.length,
    minMs: Number(sorted[0].toFixed(3)),
    p50Ms: Number(quantile(0.5).toFixed(3)),
    p95Ms: Number(quantile(0.95).toFixed(3)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(3)),
    meanMs: Number(mean.toFixed(3)),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "synlexa-bench-"));

  try {
    const nativeBin = resolveNativeCli(opts.nativeBin);
    const wasm = await loadWasmEngine(WASM_PATH);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "fixtures-manifest.json"), "utf8")
    );
    const manifestChecks = verifyFixtureManifestMirror(manifest);
    const shaByFile = new Map(manifestChecks.map((m) => [m.fileName, m.sha256]));

    // 1. All 4 protein pairs (+ 3HS4 PDB format pair)
    const structurePairs = [
      {
        key: "3hs4_cif",
        label: "3HS4.cif (A) vs AF-P00918-F1-model_v6.cif (A) + PAE",
        refFile: "3HS4.cif",
        refChain: "A",
        mobFile: "AF-P00918-F1-model_v6.cif",
        mobChain: "A",
        paeFile: "AF-P00918-F1-predicted_aligned_error_v6.json",
      },
      {
        key: "3hs4_pdb",
        label: "3HS4.pdb (A) vs AF-P00918-F1-model_v6.pdb (A)",
        refFile: "3HS4.pdb",
        refChain: "A",
        mobFile: "AF-P00918-F1-model_v6.pdb",
        mobChain: "A",
        paeFile: null,
      },
      {
        key: "1ubq_cif",
        label: "1UBQ.cif (A) vs AF-P0CG48-F1-model_v6.cif (A)",
        refFile: "1UBQ.cif",
        refChain: "A",
        mobFile: "AF-P0CG48-F1-model_v6.cif",
        mobChain: "A",
        paeFile: null,
      },
      {
        key: "1a3n_cif",
        label: "1A3N.cif (B) vs AF-P68871-F1-model_v6.cif (A)",
        refFile: "1A3N.cif",
        refChain: "B",
        mobFile: "AF-P68871-F1-model_v6.cif",
        mobChain: "A",
        paeFile: null,
      },
      {
        key: "1lz1_cif",
        label: "1LZ1.cif (A) vs AF-P61626-F1-model_v6.cif (A)",
        refFile: "1LZ1.cif",
        refChain: "A",
        mobFile: "AF-P61626-F1-model_v6.cif",
        mobChain: "A",
        paeFile: null,
      },
    ];

    const parityChecks = [];
    const loadedPairs = {};

    for (const pair of structurePairs) {
      const refPath = path.join(FIXTURES_DIR, pair.refFile);
      const mobPath = path.join(FIXTURES_DIR, pair.mobFile);
      const paePath = pair.paeFile ? path.join(FIXTURES_DIR, pair.paeFile) : null;
      const refText = fs.readFileSync(refPath, "utf8");
      const mobText = fs.readFileSync(mobPath, "utf8");
      const paeText = paePath ? fs.readFileSync(paePath, "utf8") : undefined;

      loadedPairs[pair.key] = { ...pair, refPath, mobPath, paePath, refText, mobText, paeText };

      const nativeOut = path.join(tmpDir, `${pair.key}_native.json`);
      const nativeRes = runNativeCompare(nativeBin, {
        refPath,
        refChain: pair.refChain,
        mobPath,
        mobChain: pair.mobChain,
        paePath,
        outPath: nativeOut,
      });
      const wasmRes = wasm.invokeJson("compare_structures", {
        refLabel: pair.refFile,
        refContent: refText,
        refChain: pair.refChain,
        mobLabel: pair.mobFile,
        mobContent: mobText,
        mobChain: pair.mobChain,
        ...(paeText ? { paeJson: paeText } : {}),
      });

      const parity = assertParity(pair.label, nativeRes, wasmRes);

      if (nativeRes.reference.sha256 !== shaByFile.get(pair.refFile)) {
        throw new Error(`${pair.refFile} sha256 mismatch vs manifest: ${nativeRes.reference.sha256}`);
      }
      if (nativeRes.mobile.sha256 !== shaByFile.get(pair.mobFile)) {
        throw new Error(`${pair.mobFile} sha256 mismatch vs manifest: ${nativeRes.mobile.sha256}`);
      }
      if (
        nativeRes.reference.confidenceKind !== "experimental_b_factor" ||
        nativeRes.mobile.confidenceKind !== "prediction_plddt"
      ) {
        throw new Error(`Confidence kind separation check failed for ${pair.label}`);
      }

      parityChecks.push(parity);
    }

    // 2. Parity + exact recovery: Synthetic rigid transform
    const synth = generateSyntheticRigidTest();
    const synthRefPath = path.join(tmpDir, "synth_ref.cif");
    const synthMobPath = path.join(tmpDir, "synth_mob.cif");
    const synthOutPath = path.join(tmpDir, "synth_native.json");
    fs.writeFileSync(synthRefPath, synth.refCif, "utf8");
    fs.writeFileSync(synthMobPath, synth.mobCif, "utf8");

    const synthNative = runNativeCompare(nativeBin, {
      refPath: synthRefPath,
      refChain: "A",
      mobPath: synthMobPath,
      mobChain: "A",
      outPath: synthOutPath,
    });
    const synthWasm = wasm.invokeJson("compare_structures", {
      refLabel: "synth_ref.cif",
      refContent: synth.refCif,
      refChain: "A",
      mobLabel: "synth_mob.cif",
      mobContent: synth.mobCif,
      mobChain: "A",
    });
    const synthParity = assertParity("synthetic rigid transform (40 CA)", synthNative, synthWasm);
    if (synthNative.metrics.rmsdAngstrom >= PARITY_TOLERANCE_A) {
      throw new Error(
        `Synthetic rigid transform RMSD too high: ${synthNative.metrics.rmsdAngstrom} >= ${PARITY_TOLERANCE_A}`
      );
    }

    const m = synthWasm.transform.matrixRowMajor4x4;
    let maxReconErr = 0;
    for (let i = 0; i < synth.mobCoords.length; i++) {
      const [mx, my, mz] = synth.mobCoords[i];
      const rx = m[0] * mx + m[1] * my + m[2] * mz + m[3];
      const ry = m[4] * mx + m[5] * my + m[6] * mz + m[7];
      const rz = m[8] * mx + m[9] * my + m[10] * mz + m[11];
      const [tx, ty, tz] = synth.refCoords[i];
      const err = Math.hypot(rx - tx, ry - ty, rz - tz);
      if (err > maxReconErr) maxReconErr = err;
    }
    if (maxReconErr >= PARITY_TOLERANCE_A) {
      throw new Error(`Synthetic 4x4 reconstruction error ${maxReconErr} >= ${PARITY_TOLERANCE_A}`);
    }
    parityChecks.push({ ...synthParity, maxReconErr });

    // 3. PubChem 6-compound Native vs Wasm + Reference Formula/MW Verification
    const pubchemPanel = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, "pubchem-panel.json"), "utf8")
    );
    const pubchemProps = pubchemPanel?.PropertyTable?.Properties || [];
    if (pubchemProps.length !== 6) {
      throw new Error(`Expected 6 compounds in pubchem-panel.json, found ${pubchemProps.length}`);
    }

    const pubchemPanelChecks = [];
    for (const row of pubchemProps) {
      const name = PUBCHEM_CID_LABELS.get(row.CID) || row.Title;
      const smiles = row.IsomericSMILES || row.CanonicalSMILES || row.SMILES || row.ConnectivitySMILES;
      if (!smiles) {
        throw new Error(`Missing SMILES in pubchem-panel.json for CID ${row.CID}`);
      }
      const nativeSmiles = runNativeSmiles(nativeBin, { name, smiles });
      const wasmSmiles = wasm.invokeJson("analyze_molecule_smiles", { name, smiles });
      pubchemPanelChecks.push(assertSmilesParity(name, row, nativeSmiles, wasmSmiles));
    }

    // 4. Ramachandran & Contact Map Native vs Wasm Parity
    const ramachandranTargets = [
      { label: "3HS4.cif (Chain A)", file: "3HS4.cif", chainId: "A" },
      { label: "AF-P00918-F1-model_v6.cif (Chain A)", file: "AF-P00918-F1-model_v6.cif", chainId: "A" },
      { label: "1UBQ.cif (Chain A)", file: "1UBQ.cif", chainId: "A" },
      { label: "1A3N.cif (Chain B)", file: "1A3N.cif", chainId: "B" },
      { label: "1LZ1.cif (Chain A)", file: "1LZ1.cif", chainId: "A" },
    ];
    const ramachandranChecks = [];
    for (const target of ramachandranTargets) {
      const inputPath = path.join(FIXTURES_DIR, target.file);
      const content = fs.readFileSync(inputPath, "utf8");
      const outPath = path.join(tmpDir, `rama_${target.file}.json`);
      const nativeRama = runNativeRamachandran(nativeBin, {
        inputPath,
        chainId: target.chainId,
        outPath,
      });
      const wasmRama = wasm.invokeJson("analyze_ramachandran", {
        content,
        chainId: target.chainId,
      });
      ramachandranChecks.push(assertRamachandranParity(target.label, nativeRama, wasmRama));
    }

    // 5. Domain smoke checks
    const caFloatCheck = wasm.extractCaCoordsF64(loadedPairs["3hs4_cif"].refText, "A", 1000);
    if (!caFloatCheck || caFloatCheck.length === 0) {
      throw new Error("extract_ca_coords_f64 returned empty buffer for 3HS4.cif");
    }
    const peptideSmoke = wasm.invokeJson("analyze_peptide", {
      sequence: "MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRIL",
      mutations: ["H10A"],
    });
    const geneSmoke = wasm.invokeJson("analyze_gene_crispr", {
      transcriptId: "NM_000067.3",
      targetCodonIndex: 94,
      nuclease: "SpCas9",
    });

    // 6. Latency benchmarks
    const p3hs4 = loadedPairs["3hs4_cif"];
    for (let i = 0; i < 2; i++) {
      wasm.invokeJson("compare_structures", {
        refLabel: p3hs4.refFile,
        refContent: p3hs4.refText,
        refChain: p3hs4.refChain,
        mobLabel: p3hs4.mobFile,
        mobContent: p3hs4.mobText,
        mobChain: p3hs4.mobChain,
        paeJson: p3hs4.paeText,
      });
    }

    const wasmCompareSamplesByPair = {};
    for (const pair of [loadedPairs["3hs4_cif"], loadedPairs["1ubq_cif"], loadedPairs["1a3n_cif"], loadedPairs["1lz1_cif"]]) {
      const samples = [];
      for (let i = 0; i < opts.wasmIterations; i++) {
        const t0 = performance.now();
        wasm.invokeJson("compare_structures", {
          refLabel: pair.refFile,
          refContent: pair.refText,
          refChain: pair.refChain,
          mobLabel: pair.mobFile,
          mobContent: pair.mobText,
          mobChain: pair.mobChain,
          ...(pair.paeText ? { paeJson: pair.paeText } : {}),
        });
        samples.push(performance.now() - t0);
      }
      wasmCompareSamplesByPair[pair.key] = summarizeTimings(samples);
    }

    const cliCompareSamples = [];
    const cliBenchOut = path.join(tmpDir, "cli_bench.json");
    for (let i = 0; i < opts.cliIterations; i++) {
      const t0 = performance.now();
      runNativeCompare(nativeBin, {
        refPath: p3hs4.refPath,
        refChain: p3hs4.refChain,
        mobPath: p3hs4.mobPath,
        mobChain: p3hs4.mobChain,
        paePath: p3hs4.paePath,
        outPath: cliBenchOut,
      });
      cliCompareSamples.push(performance.now() - t0);
    }

    const wasmSmilesSamples = [];
    for (let i = 0; i < opts.wasmIterations; i++) {
      const t0 = performance.now();
      for (const row of pubchemProps) {
        const name = PUBCHEM_CID_LABELS.get(row.CID) || row.Title;
        const smiles = row.IsomericSMILES || row.CanonicalSMILES || row.SMILES || row.ConnectivitySMILES;
        wasm.invokeJson("analyze_molecule_smiles", { name, smiles });
      }
      wasmSmilesSamples.push(performance.now() - t0);
    }

    const wasmRamachandranSamples = [];
    for (let i = 0; i < opts.wasmIterations; i++) {
      const t0 = performance.now();
      wasm.invokeJson("analyze_ramachandran", {
        content: p3hs4.refText,
        chainId: "A",
      });
      wasmRamachandranSamples.push(performance.now() - t0);
    }

    const report = {
      ruoNotice: "Research-Use-Only (RUO). Deterministic Native vs. Wasm parity & latency verification.",
      wasmArtifact: {
        path: "apps/web/public/wasm/synlexa_bio_core.wasm",
        sizeBytes: wasm.wasmBytes,
        abiVersion: wasm.abiVersion,
      },
      nativeBinary: path.relative(ROOT, nativeBin),
      manifestFixtureCount: manifestChecks.length,
      parityChecks,
      pubchemPanelChecks,
      ramachandranChecks,
      domainSmokeChecks: {
        extractCaCoordsF64Count: caFloatCheck.length / 4,
        peptideWtMwDa: peptideSmoke.wildType?.mwAverageDa ?? null,
        geneSymbol: geneSmoke.geneSymbol ?? null,
        pubchemCompoundsVerified: pubchemPanelChecks.length,
      },
      timings: {
        wasmCompare3hs4VsAfCif: wasmCompareSamplesByPair["3hs4_cif"],
        wasmCompare1ubqVsAfCif: wasmCompareSamplesByPair["1ubq_cif"],
        wasmCompare1a3nBVsAfCif: wasmCompareSamplesByPair["1a3n_cif"],
        wasmCompare1lz1VsAfCif: wasmCompareSamplesByPair["1lz1_cif"],
        nativeCliSubprocess3hs4VsAfCif: summarizeTimings(cliCompareSamples),
        wasmSmiles6CompoundPanel: summarizeTimings(wasmSmilesSamples),
        wasmRamachandran3hs4: summarizeTimings(wasmRamachandranSamples),
      },
    };

    if (opts.jsonOnly) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("=== Synlexa Studio Benchmark & Parity Report ===");
      console.log(`Wasm artifact : ${report.wasmArtifact.path} (${report.wasmArtifact.sizeBytes} bytes, ABI v${report.wasmArtifact.abiVersion})`);
      console.log(`Native binary : ${report.nativeBinary}`);
      console.log(`Fixtures      : ${report.manifestFixtureCount} pinned files verified across tests/fixtures & public/fixtures`);
      console.log("");
      console.log("Structure Parity Checks (tolerance <= 1e-6 A):");
      for (const p of report.parityChecks) {
        console.log(
          `  PASS ${p.label}: matchedCa=${p.matchedCaCount}, RMSD=${p.rmsdAngstrom.toFixed(6)} A, |ΔRMSD|=${p.rmsdDiff.toExponential(2)}, max|ΔM|=${p.maxMatrixDiff.toExponential(2)}, max|Δd_i|=${p.maxResDistDiff.toExponential(2)}`
        );
      }
      console.log("");
      console.log("PubChem Small-Molecule Panel Parity (Native vs Wasm & PubChem Formula/MW):");
      for (const c of report.pubchemPanelChecks) {
        console.log(
          `  PASS CID ${c.cid} ${c.name}: formula=${c.formula} (PubChem=${c.pubchemFormula}), MW=${c.coreMwDa} Da (PubChem=${c.pubchemMwDa} Da, Δ=${c.mwDeltaDa} Da), TPSA=${c.tpsaA2} A^2`
        );
      }
      console.log("");
      console.log("Ramachandran & Contact Map Parity (Native vs Wasm):");
      for (const r of report.ramachandranChecks) {
        console.log(
          `  PASS ${r.label}: residues=${r.residueCount}, H/S/L=${r.secondaryCounts.helix}/${r.secondaryCounts.sheet}/${r.secondaryCounts.loop}, favored=${r.regionCounts.favored}, contacts=${r.contactPairCount}, max|Δangle|=${r.maxAngleDiff.toExponential(2)}`
        );
      }
      console.log("");
      console.log(
        `Domain Smoke: extract_ca_coords_f64=${report.domainSmokeChecks.extractCaCoordsF64Count} atoms, peptide WT MW=${report.domainSmokeChecks.peptideWtMwDa}, gene=${report.domainSmokeChecks.geneSymbol}`
      );
      console.log("");
      console.log("Timings (ms):");
      for (const [name, t] of Object.entries(report.timings)) {
        console.log(
          `  ${name}: n=${t.n} min=${t.minMs} p50=${t.p50Ms} p95=${t.p95Ms} max=${t.maxMs} mean=${t.meanMs}`
        );
      }
      console.log("");
      console.log("JSON Summary:");
      console.log(JSON.stringify(report, null, 2));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("BENCHMARK/PARITY FAILURE:", err?.stack || err);
  process.exit(1);
});
