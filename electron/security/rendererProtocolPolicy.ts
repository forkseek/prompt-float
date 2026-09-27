import path from "node:path";
import {
  PACKAGED_RENDERER_HOST,
  PACKAGED_RENDERER_ORIGIN,
  PACKAGED_RENDERER_SCHEME,
  PACKAGED_RENDERER_URL,
} from "../../shared/securityPolicy";

export function resolvePackagedRendererFile(
  rendererDirectory: string,
  requestUrl: string,
): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== `${PACKAGED_RENDERER_SCHEME}:` ||
    url.hostname !== PACKAGED_RENDERER_HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  let relativeRequestPath: string;
  try {
    relativeRequestPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!relativeRequestPath || relativeRequestPath.includes("\0")) return null;

  const root = path.resolve(rendererDirectory);
  const filePath = path.resolve(root, relativeRequestPath);
  const relativeFilePath = path.relative(root, filePath);
  if (
    !relativeFilePath ||
    relativeFilePath.startsWith("..") ||
    path.isAbsolute(relativeFilePath)
  ) {
    return null;
  }
  return filePath;
}

export function isPackagedRendererDocument(requestUrl: string): boolean {
  return requestUrl === PACKAGED_RENDERER_URL;
}

export function isTrustedPackagedRendererInitiator(
  initiatorOrigin: string | undefined,
): boolean {
  return (
    initiatorOrigin === undefined ||
    initiatorOrigin === PACKAGED_RENDERER_ORIGIN
  );
}
