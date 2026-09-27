const assert = require("node:assert/strict");
const test = require("node:test");
const { inspectLockfile } = require("./check-lockfile.cjs");

const metadata = { name: "example", version: "1.0.0", dependencies: { safe: "1.0.0" } };
const trusted = {
  lockfileVersion: 3,
  packages: {
    "": { ...metadata },
    "node_modules/safe": {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/safe/-/safe-1.0.0.tgz",
      integrity: "sha512-aGVsbG8=",
    },
  },
};

test("accepts a pinned official npm tarball", () => {
  assert.deepEqual(inspectLockfile(metadata, trusted), []);
});

test("rejects changed root dependencies and a malicious tarball host", () => {
  const changed = structuredClone(trusted);
  changed.packages[""].dependencies.safe = "2.0.0";
  changed.packages["node_modules/safe"].resolved =
    "https://attacker.example/safe/-/safe-1.0.0.tgz";
  assert.equal(inspectLockfile(metadata, changed).length, 2);
});

test("rejects registry entries without integrity", () => {
  const changed = structuredClone(trusted);
  delete changed.packages["node_modules/safe"].integrity;
  assert.match(inspectLockfile(metadata, changed)[0], /unsigned resolved/);
});

test("rejects non-registry dependency specs even when no tarball URL is recorded", () => {
  const changed = structuredClone(trusted);
  changed.packages["node_modules/safe"] = { version: "file:../untrusted" };
  assert.match(inspectLockfile(metadata, changed)[0], /not exact semver/);
  changed.packages[""].dependencies.safe = "git+https://example.invalid/repo.git";
  assert.match(inspectLockfile(metadata, changed).join(" "), /not a registry version range/);
});
