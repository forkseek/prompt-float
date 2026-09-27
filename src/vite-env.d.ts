/// <reference types="vite/client" />

import type { PromptFloatApi } from "../shared/types";

declare global {
  interface Window {
    promptFloat: PromptFloatApi;
  }
}

export {};
