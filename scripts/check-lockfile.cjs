const fs = require("node:fs");
const path = require("node:path");
const EXACT_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REGISTRY_RANGE = /^(?:[~^])?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;

function inspectLockfile(packageMetadata, lockfile) {
  const failures = [];
  if (lockfile.lockfileVersion !== 3 || !lockfile.packages?.[""]) {
    failures.push("A version 3 npm lockfile with root metadata is required");
    return failures;
  }
  const root = lockfile.packages[""];
  if (root.version !== packageMetadata.version || root.name !== packageMetadata.name) {
    failures.push("Root package identity differs from package.json");
  }
  for (const key of ["dependencies", "devDependencies"]) {
    if (JSON.stringify(root[key] || {}) !== JSON.stringify(packageMetadata[key] || {})) {
      failures.push(`Root ${key} differs from package.json`);
    }
    for (const [name, range] of Object.entries(root[key] || {})) {
      if (typeof range !== "string" || !REGISTRY_RANGE.test(range)) {
        failures.push(`${name}: root dependency is not a registry version range`);
      }
    }
  }
  for (const [name, entry] of Object.entries(lockfile.packages)) {
    if (!name) continue;
    if (typeof entry.version !== "string" || !EXACT_VERSION.test(entry.version)) {
      failures.push(`${name}: dependency version is not exact semver`);
      continue;
    }
    if (entry.link || entry.resolved && !entry.integrity) {
      failures.push(`${name}: link or unsigned resolved dependency`);
      continue;
    }
    if (entry.resolved) {
      let url;
      try {
        url = new URL(entry.resolved);
      } catch {
        failures.push(`${name}: invalid registry URL`);
        continue;
      }
      if (
        url.protocol !== "https:" ||
        url.hostname !== "registry.npmjs.org" ||
        url.username || url.password || url.search || url.hash ||
        !url.pathname.includes("/-/") ||
        !/^sha512-[A-Za-z0-9+/=]+$/.test(entry.integrity)
      ) {
        failures.push(`${name}: untrusted registry origin or integrity`);
      }
    } else if (entry.integrity) {
      failures.push(`${name}: integrity without an exact source`);
    }
  }
  return failures;
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const metadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lockfile = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const failures = inspectLockfile(metadata, lockfile);
  if (failures.length > 0) {
    console.error(failures.slice(0, 20).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Lockfile sources and integrity verified");
  }
}

module.exports = { inspectLockfile };
