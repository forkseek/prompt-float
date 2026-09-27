import { isIP } from "node:net";
import releaseTarget from "../../shared/releaseTarget.json";

export type TrustedUpdateConfig =
  | { provider: "generic"; updateUrl: string; publisherName: string }
  | {
      provider: "github";
      owner: string;
      repo: string;
      host: string;
      protocol: "https";
      publisherName: string;
    };

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
  if (!embedded || !updater) return null;

  const publisherName = embedded.publisherName;
  const updaterPublishers = updater.publisherName;
  const cacheDirName = updater.updaterCacheDirName;
  if (
    typeof publisherName !== "string" ||
    !publisherName.trim() ||
    publisherName.length > 300 ||
    !Array.isArray(updaterPublishers) ||
    updaterPublishers.length !== 1 ||
    updaterPublishers[0] !== publisherName ||
    (cacheDirName !== undefined &&
      (typeof cacheDirName !== "string" ||
        !/^[a-zA-Z0-9._-]{1,128}$/.test(cacheDirName) ||
        cacheDirName.includes("..")))
  ) {
    return null;
  }

  if (updater.provider === "github") {
    const allowedKeys = new Set([
      "provider", "owner", "repo", "host", "protocol", "publisherName",
      "updaterCacheDirName",
    ]);
    if (Object.keys(updater).some((key) => !allowedKeys.has(key))) return null;
    for (const [key, value] of Object.entries(releaseTarget)) {
      if (embedded[key] !== value || updater[key] !== value) return null;
    }
    return {
      provider: "github",
      owner: releaseTarget.owner,
      repo: releaseTarget.repo,
      host: releaseTarget.host,
      protocol: "https",
      publisherName,
    };
  }

  if (updater.provider !== "generic" ||
      (embedded.provider !== undefined && embedded.provider !== "generic")) {
    return null;
  }
  const updateUrl = normalizeUpdateUrl(embedded.updateUrl);
  if (!updateUrl || normalizeUpdateUrl(updater.url) !== updateUrl) return null;
  return { provider: "generic", updateUrl, publisherName };
}
