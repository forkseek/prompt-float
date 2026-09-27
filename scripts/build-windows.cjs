const path = require("node:path");
const { version } = require("../package.json");
const { Arch, build, Platform } = require("electron-builder");
const { signedReleaseConfiguration } = require("./release-config.cjs");

process.env.ELECTRON_BUILDER_CACHE = path.resolve(
  process.cwd(),
  ".electron-builder-cache",
);

const config = {
  directories: { output: path.join("release", `v${version}`) },
  ...signedReleaseConfiguration(process.env),
};

build({
  targets: Platform.WINDOWS.createTarget(["nsis", "portable"], Arch.x64),
  publish: "never",
  config,
}).catch((error) => {
  console.error(error instanceof Error ? error.message : "Windows build failed");
  process.exitCode = 1;
});
