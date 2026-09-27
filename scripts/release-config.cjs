const { isIP } = require("node:net");

function requireText(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for signed releases`);
  return value;
}

function normalizeUpdateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PROMPT_FLOAT_UPDATE_URL must be a valid HTTPS directory");
  }
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
    throw new Error("PROMPT_FLOAT_UPDATE_URL must be a credential-free HTTPS directory");
  }
  return url.href;
}

function signedReleaseConfiguration(environment) {
  const updateUrl = normalizeUpdateUrl(
    requireText(environment, "PROMPT_FLOAT_UPDATE_URL"),
  );
  const publisherName = requireText(environment, "PROMPT_FLOAT_PUBLISHER_NAME");
  const appId = requireText(environment, "PROMPT_FLOAT_APP_ID");
  const author = requireText(environment, "PROMPT_FLOAT_AUTHOR");
  requireText(environment, "CSC_LINK");
  requireText(environment, "CSC_KEY_PASSWORD");

  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/i.test(appId)) {
    throw new Error("PROMPT_FLOAT_APP_ID must be a reverse-domain identifier");
  }
  if (publisherName.length > 300 || author.length > 200) {
    throw new Error("Release publisher or author is too long");
  }

  return {
    appId,
    extraMetadata: {
      author,
      releaseTrust: { updateUrl, publisherName },
    },
    publish: [{ provider: "generic", url: updateUrl, publisherName: [publisherName] }],
    win: {
      forceCodeSigning: true,
      verifyUpdateCodeSignature: true,
      signtoolOptions: { publisherName },
    },
  };
}

module.exports = { signedReleaseConfiguration };
