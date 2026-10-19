/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 线上后端地址（生产构建时注入）。开发留空走 Vite 代理。 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
