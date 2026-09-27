const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { localPortableConfiguration } = require("./build-portable.cjs");

test("unsigned portable builds are separated and visibly marked local-only", () => {
  const config = localPortableConfiguration("0.6.2");
  assert.equal(
    config.directories.output,
    path.join("release", "local-verification", "v0.6.2"),
  );
  assert.match(config.portable.artifactName, /UNSIGNED-LOCAL-ONLY/);
});
