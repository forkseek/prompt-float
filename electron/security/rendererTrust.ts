import path from "node:path";
import { pathToFileURL } from "node:url";
import { PACKAGED_RENDERER_URL } from "../../shared/securityPolicy";

const DEVELOPMENT_RENDERER_ORIGIN = "http://127.0.0.1:5173";

export type RendererTarget =
  | Readonly<{
      kind: "packaged-url";
      url: string;
      trustedUrl: string;
    }>
  | Readonly<{
      kind: "file";
      filePath: string;
      trustedUrl: string;
    }>
  | Readonly<{
      kind: "development-url";
      url: string;
      trustedUrl: string;
    }>;

export interface RendererTargetOptions {
  packaged: boolean;
  rendererFilePath: string;
  developmentServerUrl?: string;
}

function resolveDevelopmentRendererUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VITE_DEV_SERVER_URL 格式不正确");
  }

  if (
    url.origin !== DEVELOPMENT_RENDERER_ORIGIN ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `VITE_DEV_SERVER_URL 仅允许 ${DEVELOPMENT_RENDERER_ORIGIN}/`,
    );
  }

  return url.href;
}

export function resolveRendererTarget({
  packaged,
  rendererFilePath,
  developmentServerUrl,
}: RendererTargetOptions): RendererTarget {
  const filePath = path.resolve(rendererFilePath);
  const fileTarget = Object.freeze({
    kind: "file" as const,
    filePath,
    trustedUrl: pathToFileURL(filePath).href,
  });

  // A packaged application must never allow its launch environment to replace
  // the renderer that receives the preload bridge.
  if (packaged) {
    return Object.freeze({
      kind: "packaged-url" as const,
      url: PACKAGED_RENDERER_URL,
      trustedUrl: PACKAGED_RENDERER_URL,
    });
  }
  if (!developmentServerUrl?.trim()) return fileTarget;

  const url = resolveDevelopmentRendererUrl(developmentServerUrl.trim());
  return Object.freeze({
    kind: "development-url" as const,
    url,
    trustedUrl: url,
  });
}
