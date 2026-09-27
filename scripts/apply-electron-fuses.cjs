const path = require("node:path");

const EXPECTED_FUSE_STATES = Object.freeze({
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
  WasmTrapHandlers: true,
});

async function loadFuseApi() {
  return import("@electron/fuses");
}

function resolvePackagedExecutable(context) {
  const productFilename = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === "win32") {
    return path.join(context.appOutDir, `${productFilename}.exe`);
  }
  if (context.electronPlatformName === "darwin") {
    return path.join(context.appOutDir, `${productFilename}.app`);
  }
  throw new Error(
    `Electron Fuse packaging is not configured for ${context.electronPlatformName}`,
  );
}

async function assertElectronFuses(executablePath) {
  const {
    FuseState,
    FuseV1Options,
    getCurrentFuseWire,
  } = await loadFuseApi();
  const fuseWire = await getCurrentFuseWire(executablePath);
  const knownFuseIndices = Object.values(FuseV1Options).filter(
    (value) => typeof value === "number",
  );
  const actualFuseIndices = Object.keys(fuseWire).filter((key) =>
    /^\d+$/.test(key),
  );

  if (actualFuseIndices.length !== knownFuseIndices.length) {
    throw new Error(
      `Electron Fuse count mismatch: expected ${knownFuseIndices.length}, found ${actualFuseIndices.length}`,
    );
  }

  for (const [name, enabled] of Object.entries(EXPECTED_FUSE_STATES)) {
    const index = FuseV1Options[name];
    if (typeof index !== "number") {
      throw new Error(`Unknown Electron Fuse option: ${name}`);
    }
    const expected = enabled ? FuseState.ENABLE : FuseState.DISABLE;
    if (fuseWire[index] !== expected) {
      throw new Error(
        `Electron Fuse ${name} is not ${enabled ? "enabled" : "disabled"}`,
      );
    }
  }
}

async function applyElectronFuses(context) {
  const {
    flipFuses,
    FuseVersion,
    FuseV1Options,
  } = await loadFuseApi();
  const executablePath = resolvePackagedExecutable(context);

  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: EXPECTED_FUSE_STATES.RunAsNode,
    [FuseV1Options.EnableCookieEncryption]:
      EXPECTED_FUSE_STATES.EnableCookieEncryption,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]:
      EXPECTED_FUSE_STATES.EnableNodeOptionsEnvironmentVariable,
    [FuseV1Options.EnableNodeCliInspectArguments]:
      EXPECTED_FUSE_STATES.EnableNodeCliInspectArguments,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
      EXPECTED_FUSE_STATES.EnableEmbeddedAsarIntegrityValidation,
    [FuseV1Options.OnlyLoadAppFromAsar]:
      EXPECTED_FUSE_STATES.OnlyLoadAppFromAsar,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]:
      EXPECTED_FUSE_STATES.LoadBrowserProcessSpecificV8Snapshot,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]:
      EXPECTED_FUSE_STATES.GrantFileProtocolExtraPrivileges,
    [FuseV1Options.WasmTrapHandlers]:
      EXPECTED_FUSE_STATES.WasmTrapHandlers,
  });

  await assertElectronFuses(executablePath);
}

module.exports = applyElectronFuses;
module.exports.assertElectronFuses = assertElectronFuses;
module.exports.EXPECTED_FUSE_STATES = EXPECTED_FUSE_STATES;
