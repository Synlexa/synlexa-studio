declare module 'node:fs/promises' {
  export function readFile(path: URL | string): Promise<Uint8Array>;
  export function readFile(path: URL | string, encoding: 'utf8'): Promise<string>;
}

declare module 'node:crypto' {
  export function createHash(algorithm: 'sha256'): {
    update(data: string | Uint8Array): { digest(encoding: 'hex'): string };
  };
}
