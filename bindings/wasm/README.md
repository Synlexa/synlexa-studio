# `@synlexa/wasm-bridge` (Developer WebAssembly SDK)

> **Looking for the Synlexa Studio desktop app?** Install [`@synlexa/studio`](https://github.com/orgs/Synlexa/packages/npm/package/studio) or download the macOS/Windows/Linux installer from [synlexa.com/download](https://www.synlexa.com/download).

This package is for **JavaScript / TypeScript developers** embedding Synlexa Studio's deterministic WebAssembly biological & cheminformatics core (`synlexa_bio_core.wasm`, ABI v1) directly inside Node.js or browser apps (Research-Use-Only).

## Install

```sh
npm install @synlexa/wasm-bridge

# Or via GitHub Packages (with read:packages token in ~/.npmrc):
npm install @synlexa/wasm-bridge --@synlexa:registry=https://npm.pkg.github.com

# Or direct release tarball:
npm install https://github.com/Synlexa/synlexa-studio/releases/download/v0.4.4/synlexa-wasm-bridge-0.4.4.tgz
```

## Example Usage

```ts
import { readFile } from 'node:fs/promises';
import { loadWasmBioCore } from '@synlexa/wasm-bridge';

const wasmBytes = await readFile(new URL('./wasm/synlexa_bio_core.wasm', import.meta.url));
const session = await loadWasmBioCore(new Uint8Array(wasmBytes));
const res = session.invokeJson('analyze_molecule_smiles', {
  name: 'Acetazolamide',
  smiles: 'CC(=O)Nc1nnc(S(N)(=O)=O)s1',
});
console.log(res.data?.formula, res.data?.molecularWeight);
```

See [`ABI.md`](ABI.md) and [Synlexa Studio](https://github.com/Synlexa/synlexa-studio) for full documentation.
