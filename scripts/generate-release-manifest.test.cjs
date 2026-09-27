const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { generateManifest } = require("./generate-release-manifest.cjs");

test("release manifest refuses a missing SBOM and hashes it when present", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-float-manifest-"));
  try {
    await fs.writeFile(path.join(directory, "Prompt Float-Setup.exe"), "test installer");
    await assert.rejects(generateManifest(directory), /SBOM\.cdx\.json is required/);
    const sbom = '{"bomFormat":"CycloneDX"}\n';
    await fs.writeFile(path.join(directory, "SBOM.cdx.json"), sbom);
    assert.equal(await generateManifest(directory), 2);
    const manifest = await fs.readFile(path.join(directory, "SHA256SUMS.txt"), "utf8");
    const hash = createHash("sha256").update(sbom).digest("hex");
    assert.match(manifest, new RegExp(`${hash}  SBOM[.]cdx[.]json`));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("release manifest refuses a directory without an executable", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "prompt-float-manifest-"));
  try {
    await fs.writeFile(path.join(directory, "SBOM.cdx.json"), "{}");
    await assert.rejects(generateManifest(directory), /release executable is required/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
