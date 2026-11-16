/// <reference types="vite/client" />

declare const __SYNLEXA_APP_VERSION__: string | undefined;

interface ImportMetaEnv {
  /** Optional Gemini API key injected at build/dev time. Never hardcode keys in source. */
  readonly VITE_GEMINI_API_KEY?: string;
  /** Optional override for optional Synlexa Cloud auth & assistant gateway origin (defaults to https://synlexa.com). */
  readonly VITE_SYNLEXA_CLOUD_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
