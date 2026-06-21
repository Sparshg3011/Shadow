import type { ShadowApi } from './index'

declare global {
  interface Window {
    shadow: ShadowApi
  }
}

export {}
