const assert = require("node:assert/strict");
const test = require("node:test");
const { signedReleaseConfiguration } = require("./release-config.cjs");
const releaseTarget = require("../shared/releaseTarget.json");

const environment = {
  PROMPT_FLOAT_PUBLISHER_NAME: "CN=Example Publisher, O=Example Org, C=US",
  PROMPT_FLOAT_APP_ID: "com.example.promptfloat",
  PROMPT_FLOAT_AUTHOR: "Example Org",
  CSC_LINK: "test-certificate-reference",
  CSC_KEY_PASSWORD: "test-only-password",
};

test("signed release pins GitHub repository and publisher inside the package", () => {
  const config = signedReleaseConfiguration(environment);
  assert.equal(config.win.forceCodeSigning, true);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.deepEqual(config.extraMetadata.releaseTrust, {
    ...releaseTarget,
    publisherName: environment.PROMPT_FLOAT_PUBLISHER_NAME,
  });
  assert.deepEqual(config.publish[0], {
    ...releaseTarget,
    publisherName: [environment.PROMPT_FLOAT_PUBLISHER_NAME],
  });
  assert.deepEqual(config.publish[0].publisherName, [environment.PROMPT_FLOAT_PUBLISHER_NAME]);
});

test("signed release refuses missing credentials and ignores hostile update environment", () => {
  for (const missing of Object.keys(environment)) {
    assert.throws(() => signedReleaseConfiguration({ ...environment, [missing]: "" }));
  }
  const config = signedReleaseConfiguration({
    ...environment,
    PROMPT_FLOAT_UPDATE_URL: "https://attacker:secret@updates.example.com/",
    GH_TOKEN: "hostile-token",
    GITHUB_REPOSITORY: "attacker/repo",
  });
  assert.equal(config.publish[0].provider, "github");
  assert.equal(config.publish[0].owner, "forkseek");
  assert.equal(config.publish[0].repo, "prompt-float");
  assert.equal(config.publish[0].token, undefined);
});
