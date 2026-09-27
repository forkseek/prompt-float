const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("release verification rejects an unsigned executable by default", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "prompt-float-signature-gate-"),
  );
  const executable = path.join(directory, "unsigned-test.exe");
  const sbom = path.join(directory, "SBOM.cdx.json");
  const hash = (file) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  try {
    fs.writeFileSync(executable, "unsigned local test artifact");
    fs.writeFileSync(sbom, "{}");
    fs.writeFileSync(
      path.join(directory, "SHA256SUMS.txt"),
      `${hash(executable)}  unsigned-test.exe\n${hash(sbom)}  SBOM.cdx.json\n`,
    );
    const result = spawnSync("pwsh", [
      "-NoProfile",
      "-File",
      path.join(__dirname, "verify-release.ps1"),
      "-ReleaseDirectory",
      directory,
      "-ExpectedPublisher",
      "CN=Local Test Publisher",
    ], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /Invalid or missing signature/,
    );
    assert.doesNotMatch(
      `${result.stdout}\n${result.stderr}`,
      /SBOM\.cdx\.json is absent from the release manifest/,
    );

    const bypassAttempt = spawnSync("pwsh", [
      "-NoProfile",
      "-File",
      path.join(__dirname, "verify-release.ps1"),
      "-ReleaseDirectory",
      directory,
      "-AllowUnsignedLocalVerification",
    ], { encoding: "utf8" });
    assert.notEqual(bypassAttempt.status, 0);
    assert.match(
      `${bypassAttempt.stdout}\n${bypassAttempt.stderr}`,
      /restricted to release\/local-verification/,
    );
  } finally {
    fs.unlinkSync(path.join(directory, "SHA256SUMS.txt"));
    fs.unlinkSync(executable);
    fs.unlinkSync(sbom);
    fs.rmdirSync(directory);
  }
});
