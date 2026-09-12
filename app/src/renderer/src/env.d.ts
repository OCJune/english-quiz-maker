/// <reference types="vite/client" />

import type { AriaApi } from '../../preload/index'

declare global {
  interface Window {
    aria: AriaApi
  }
}
