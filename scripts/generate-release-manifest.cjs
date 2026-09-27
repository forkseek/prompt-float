const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { version } = require("../package.json");

const RELEASE_EXTENSIONS = new Set([".exe", ".yml", ".blockmap"]);

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

async function generateManifest(releaseDirectory) {
  const entries = await fs.readdir(releaseDirectory, { withFileTypes: true });
  if (!entries.some((entry) => entry.isFile() && entry.name === "SBOM.cdx.json")) {
    throw new Error("Release SBOM.cdx.json is required before generating hashes");
  }
  if (!entries.some((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".exe")) {
    throw new Error("At least one release executable is required before generating hashes");
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        ((RELEASE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) &&
          entry.name !== "builder-debug.yml") ||
          entry.name === "SBOM.cdx.json"),
    )
    .map((entry) => path.join(releaseDirectory, entry.name))
    .sort();
  if (files.length === 0) throw new Error("No current-version release artifacts found");

  const lines = [];
  for (const filePath of files) {
    lines.push(`${await sha256(filePath)}  ${path.basename(filePath)}`);
  }
  await fs.writeFile(
    path.join(releaseDirectory, "SHA256SUMS.txt"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
  return lines.length;
}

if (require.main === module) {
  const releaseDirectory = path.resolve(process.cwd(), "release", `v${version}`);
  generateManifest(releaseDirectory).then((count) => {
    console.log(`Wrote SHA256SUMS.txt for ${count} v${version} artifacts`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Manifest generation failed");
    process.exitCode = 1;
  });
}

module.exports = { generateManifest };
