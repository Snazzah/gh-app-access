import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export class ConfigNotFoundError extends Error {
  constructor() {
    super("GitHub App configuration was not found.");
    this.name = "ConfigNotFoundError";
  }
}

export function getConfigDirectory({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
} = {}) {
  if (env.GH_APP_ACCESS_HOME) {
    return path.resolve(env.GH_APP_ACCESS_HOME);
  }

  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "gh-app-access");
  }

  return path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "gh-app-access");
}

function getConfigPaths(directory = getConfigDirectory()) {
  return {
    directory,
    configPath: path.join(directory, "config.json"),
    privateKeyPath: path.join(directory, "private-key.pem"),
  };
}

export async function configExists() {
  try {
    await access(getConfigPaths().configPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadConfig() {
  const { configPath } = getConfigPaths();
  let parsed;

  try {
    parsed = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ConfigNotFoundError();
    }
    throw new Error(`Could not read ${configPath}: ${error.message}`);
  }

  if (!parsed || typeof parsed.appId !== "string" || !parsed.appId.trim()) {
    throw new Error(`The config at ${configPath} has an invalid appId.`);
  }
  if (typeof parsed.privateKeyPath !== "string" || !parsed.privateKeyPath) {
    throw new Error(`The config at ${configPath} has an invalid privateKeyPath.`);
  }

  let privateKey;
  try {
    privateKey = await readFile(parsed.privateKeyPath, "utf8");
  } catch (error) {
    throw new Error(`Could not read the saved private key: ${error.message}`);
  }

  return { appId: parsed.appId, privateKey };
}

async function moveIfPresent(from, to) {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function saveConfig({ appId, privateKey }) {
  const paths = getConfigPaths();
  const suffix = randomUUID();
  const tempKey = `${paths.privateKeyPath}.${suffix}.tmp`;
  const tempConfig = `${paths.configPath}.${suffix}.tmp`;
  const backupKey = `${paths.privateKeyPath}.${suffix}.bak`;
  const backupConfig = `${paths.configPath}.${suffix}.bak`;
  let backedUpKey = false;
  let backedUpConfig = false;
  let installedKey = false;
  let installedConfig = false;

  await mkdir(paths.directory, { recursive: true });

  try {
    await writeFile(tempKey, privateKey, { encoding: "utf8", mode: 0o600 });
    await writeFile(
      tempConfig,
      `${JSON.stringify({ appId: String(appId), privateKeyPath: paths.privateKeyPath }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );

    backedUpKey = await moveIfPresent(paths.privateKeyPath, backupKey);
    backedUpConfig = await moveIfPresent(paths.configPath, backupConfig);

    await rename(tempKey, paths.privateKeyPath);
    installedKey = true;
    await rename(tempConfig, paths.configPath);
    installedConfig = true;

    if (process.platform !== "win32") {
      await chmod(paths.privateKeyPath, 0o600);
      await chmod(paths.configPath, 0o600);
    }

    await rm(backupKey, { force: true });
    await rm(backupConfig, { force: true });
  } catch (error) {
    if (installedConfig) await rm(paths.configPath, { force: true });
    if (installedKey) await rm(paths.privateKeyPath, { force: true });
    if (backedUpKey) await rename(backupKey, paths.privateKeyPath);
    if (backedUpConfig) await rename(backupConfig, paths.configPath);
    throw error;
  } finally {
    await rm(tempKey, { force: true });
    await rm(tempConfig, { force: true });
    await rm(backupKey, { force: true });
    await rm(backupConfig, { force: true });
  }
}
