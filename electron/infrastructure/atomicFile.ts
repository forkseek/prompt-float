import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function writeTextFileRecoverably(
  filePath: string,
  content: string,
): Promise<void> {
  const directory = path.dirname(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const backupPath = `${filePath}.bak`;
  await fs.mkdir(directory, { recursive: true });
  const handle = await fs.open(temporaryPath, "wx", 0o600);
  let writeError: unknown;
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch (error) {
    writeError = error;
  } finally {
    await handle.close();
  }
  if (writeError) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw writeError;
  }
  let movedExisting = false;
  try {
    try {
      // Keep an existing backup when the primary disappeared during a crash.
      const stat = await fs.lstat(filePath);
      if (!stat.isFile()) throw new Error("Refusing to replace a non-file path");
      await fs.rm(backupPath, { force: true });
      await fs.rename(filePath, backupPath);
      movedExisting = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      if (movedExisting) {
        await fs.rename(backupPath, filePath).catch(() => undefined);
      }
      throw error;
    }

    // Keep the previous valid revision for a future recovery.
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function restoreTextFileFromBackup(filePath: string): Promise<void> {
  const backupPath = `${filePath}.bak`;
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const quarantinePath = `${filePath}.corrupt-${Date.now()}-${randomUUID()}`;
  let quarantined = false;

  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile()) throw new Error("Refusing to move a non-file path");
    await fs.rename(filePath, quarantinePath);
    quarantined = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  try {
    await fs.copyFile(backupPath, temporaryPath, fs.constants.COPYFILE_EXCL);
    const handle = await fs.open(temporaryPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    if (quarantined) {
      await fs.rename(quarantinePath, filePath).catch(() => undefined);
    }
    throw error;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
