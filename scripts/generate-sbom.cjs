const { execFileSync } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const packageMetadata = require("../package.json");
const { version } = packageMetadata;

async function main() {
  const root = path.resolve(__dirname, "..");
  const releaseRoot = path.join(root, "release");
  const outputFlag = process.argv.indexOf("--output");
  if (outputFlag !== -1 && (outputFlag !== process.argv.length - 2)) {
    throw new Error("Usage: generate-sbom.cjs [--output release/.../SBOM.cdx.json]");
  }
  const output = path.resolve(
    root,
    outputFlag === -1
      ? path.join("release", `v${version}`, "SBOM.cdx.json")
      : process.argv[outputFlag + 1],
  );
  if (
    !output.startsWith(releaseRoot + path.sep) ||
    path.basename(output) !== "SBOM.cdx.json"
  ) {
    throw new Error("SBOM output must be a release subdirectory's SBOM.cdx.json");
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("Run this script through npm run sbom");
  const data = execFileSync(
    process.execPath,
    [npmCli, "sbom", "--sbom-format", "cyclonedx"],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 120_000 },
  );
  const document = JSON.parse(data);
  if (
    document.bomFormat !== "CycloneDX" ||
    !Array.isArray(document.components) || document.components.length === 0
  ) {
    throw new Error("npm did not produce a valid CycloneDX component list");
  }
  const names = new Set(document.components.map((component) => component.name));
  const missingDirect = Object.keys(packageMetadata.dependencies || {})
    .filter((name) => !names.has(name));
  if (missingDirect.length > 0) {
    throw new Error(`SBOM omitted direct dependencies: ${missingDirect.join(", ")}`);
  }
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`Wrote ${output} with ${document.components.length} components`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "SBOM generation failed");
  process.exitCode = 1;
});
