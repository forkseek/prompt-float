const assert = require("node:assert/strict");
const test = require("node:test");
const { signedReleaseConfiguration } = require("./release-config.cjs");

const environment = {
  PROMPT_FLOAT_UPDATE_URL: "https://updates.example.com/prompt-float/",
  PROMPT_FLOAT_PUBLISHER_NAME: "CN=Example Publisher, O=Example Org, C=US",
  PROMPT_FLOAT_APP_ID: "com.example.promptfloat",
  PROMPT_FLOAT_AUTHOR: "Example Org",
  CSC_LINK: "test-certificate-reference",
  CSC_KEY_PASSWORD: "test-only-password",
};

test("signed release pins its feed and publisher inside the package", () => {
  const config = signedReleaseConfiguration(environment);
  assert.equal(config.win.forceCodeSigning, true);
  assert.equal(config.win.verifyUpdateCodeSignature, true);
  assert.equal(config.extraMetadata.releaseTrust.updateUrl, config.publish[0].url);
  assert.deepEqual(config.publish[0].publisherName, [environment.PROMPT_FLOAT_PUBLISHER_NAME]);
});

test("signed release refuses missing credentials and untrusted feeds", () => {
  for (const missing of Object.keys(environment)) {
    assert.throws(() => signedReleaseConfiguration({ ...environment, [missing]: "" }));
  }
  assert.throws(() => signedReleaseConfiguration({
    ...environment,
    PROMPT_FLOAT_UPDATE_URL: "http://127.0.0.1:8080/",
  }));
  assert.throws(() => signedReleaseConfiguration({
    ...environment,
    PROMPT_FLOAT_UPDATE_URL: "https://attacker:secret@updates.example.com/",
  }));
});
