const BASE_RENDERER_DIRECTIVES = [
  "default-src 'none'",
  "base-uri 'none'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "img-src 'self' data:",
  "manifest-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "worker-src 'none'",
] as const;

export const PACKAGED_RENDERER_SCHEME = "prompt-float";
export const PACKAGED_RENDERER_HOST = "app";
export const PACKAGED_RENDERER_ORIGIN =
  `${PACKAGED_RENDERER_SCHEME}://${PACKAGED_RENDERER_HOST}`;
export const PACKAGED_RENDERER_URL = `${PACKAGED_RENDERER_ORIGIN}/index.html`;

export const PRODUCTION_RENDERER_CSP = [
  ...BASE_RENDERER_DIRECTIVES,
  "connect-src 'none'",
  "style-src 'self'",
].join("; ");

export const PRODUCTION_RENDERER_CSP_HEADER = [
  PRODUCTION_RENDERER_CSP,
  "frame-ancestors 'none'",
].join("; ");

export const DEVELOPMENT_RENDERER_CSP = [
  ...BASE_RENDERER_DIRECTIVES,
  "connect-src 'self' ws://127.0.0.1:5173",
  "style-src 'self' 'unsafe-inline'",
].join("; ");
