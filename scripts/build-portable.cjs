const path = require("node:path");
const { version } = require("../package.json");
const { Arch, build, Platform } = require("electron-builder");

function localPortableConfiguration(packageVersion = version) {
  return {
    directories: {
      output: path.join("release", "local-verification", `v${packageVersion}`),
    },
    portable: {
      artifactName: "${productName}-UNSIGNED-LOCAL-ONLY-${version}-${arch}.${ext}",
    },
  };
}

if (require.main === module) {
  process.env.ELECTRON_BUILDER_CACHE = path.resolve(
    process.cwd(),
    ".electron-builder-cache",
  );
  build({
    targets: Platform.WINDOWS.createTarget(["portable"], Arch.x64),
    publish: "never",
    config: localPortableConfiguration(),
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Portable build failed");
    process.exitCode = 1;
  });
}

module.exports = { localPortableConfiguration };
