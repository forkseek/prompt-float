import { isIP } from "node:net";

export interface TrustedUpdateConfig {
  updateUrl: string;
  publisherName: string;
}

type SignatureVerifier = (
  publisherNames: string[],
  installerPath: string,
) => Promise<string | null>;

export function pinUpdateSignatureVerifier(
  publisherName: string,
  systemVerifier: SignatureVerifier,
): SignatureVerifier {
  return (_configurationPublishers, installerPath) =>
    systemVerifier([publisherName], installerPath);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeUpdateUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.includes(".") ||
      isIP(url.hostname) !== 0 ||
      url.hostname.endsWith(".local") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export function resolveTrustedUpdateConfig(
  packageMetadata: unknown,
  updaterMetadata: unknown,
): TrustedUpdateConfig | null {
  const embedded = record(record(packageMetadata)?.releaseTrust);
  const updater = record(updaterMetadata);
  if (!embedded || !updater || updater.provider !== "generic") return null;

  const updateUrl = normalizeUpdateUrl(embedded.updateUrl);
  const updaterUrl = normalizeUpdateUrl(updater.url);
  const publisherName = embedded.publisherName;
  const updaterPublishers = updater.publisherName;
  if (
    !updateUrl ||
    updaterUrl !== updateUrl ||
    typeof publisherName !== "string" ||
    !publisherName.trim() ||
    publisherName.length > 300 ||
    !Array.isArray(updaterPublishers) ||
    updaterPublishers.length !== 1 ||
    updaterPublishers[0] !== publisherName
  ) {
    return null;
  }
  return { updateUrl, publisherName };
}
