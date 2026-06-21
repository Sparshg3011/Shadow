/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SHADOW_AVATAR_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
