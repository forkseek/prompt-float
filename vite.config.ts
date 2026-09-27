import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  DEVELOPMENT_RENDERER_CSP,
  PRODUCTION_RENDERER_CSP,
} from "./shared/securityPolicy";

const CSP_PLACEHOLDER = "__PROMPT_FLOAT_CSP__";

function contentSecurityPolicyPlugin(production: boolean): Plugin {
  return {
    name: "prompt-float-content-security-policy",
    transformIndexHtml(html) {
      if (!html.includes(CSP_PLACEHOLDER)) {
        throw new Error("Renderer CSP placeholder is missing from index.html");
      }
      return html.replace(
        CSP_PLACEHOLDER,
        production ? PRODUCTION_RENDERER_CSP : DEVELOPMENT_RENDERER_CSP,
      );
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [contentSecurityPolicyPlugin(command === "build"), react()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
}));
