#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ConfigNotFoundError,
  configExists,
  loadConfig,
  saveConfig,
} from "../src/config.mjs";
import { answerCredentialRequest } from "../src/credential.mjs";
import {
  cloneRepository,
  configureRepository,
  inspectRepository,
  parseRepo,
} from "../src/git.mjs";
import {
  GitHubAccessError,
  createAppJwt,
  mintInstallationToken,
} from "../src/github-app.mjs";
import { finishSetup, promptForSetup } from "../src/prompts.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
);

const HELP = `Usage: gh-app-access <command> [options]

Commands:
  setup                         Save GitHub App credentials
  clone <repo> [directory]      Clone a repository and configure credentials
  configure [directory]         Configure an existing repository
  credential <get|store|erase>  Git credential helper protocol

Options:
  -h, --help                    Show help
  -v, --version                 Show version`;

function printHelp() {
  console.log(HELP);
}

function usageError(message) {
  const error = new Error(`${message}\n\n${HELP}`);
  error.name = "UsageError";
  return error;
}

async function getSavedConfig() {
  const config = await loadConfig();

  try {
    await createAppJwt(config);
  } catch {
    throw new Error(
      "The saved private key does not look valid.\nRun setup again:\n\n  npx @snazzah/gh-app-access setup",
    );
  }

  return config;
}

async function runSetup() {
  const setup = await promptForSetup({
    hasExistingConfig: await configExists(),
    validatePrivateKey: ({ appId, privateKey }) =>
      createAppJwt({ appId, privateKey }),
  });

  if (!setup) {
    return;
  }

  await saveConfig(setup);
  finishSetup();
}

async function runClone(args) {
  if (args.length < 1 || args.length > 2) {
    throw usageError("clone expects <repo> and an optional [directory].");
  }

  const repo = parseRepo(args[0]);
  const directory = args[1];
  const config = await getSavedConfig();
  const token = await mintInstallationToken({ ...config, ...repo });
  const root = await cloneRepository({ ...repo, directory, token });

  try {
    await configureRepository({ root, ...repo });
  } catch (error) {
    throw new Error(
      `Cloned ${repo.owner}/${repo.repo} to ${root}, but credential setup failed.\n` +
        `Run this after fixing the error:\n\n  npx @snazzah/gh-app-access configure ${JSON.stringify(root)}\n\n` +
        `Cause: ${error.message}`,
    );
  }

  console.log(`Cloned and configured ${repo.owner}/${repo.repo} at ${root}.`);
}

async function runConfigure(args) {
  if (args.length > 1) {
    throw usageError("configure accepts one optional [directory].");
  }

  const inspected = await inspectRepository(args[0] ?? process.cwd());
  const config = await getSavedConfig();
  await mintInstallationToken({ ...config, ...inspected.repo });
  await configureRepository({ root: inspected.root, ...inspected.repo });

  console.log(`Configured ${inspected.root}.`);
  console.log(`Origin: https://github.com/${inspected.repo.owner}/${inspected.repo.repo}.git`);
  console.log("Future plain git pull commands will use the GitHub App.");
}

async function runCredential(args) {
  try {
    await answerCredentialRequest({ operation: args[0], input: process.stdin });
  } catch (error) {
    console.error(`gh-app-access credential: ${error.message}`);
  }
}

async function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return;
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(packageJson.version);
    return;
  }

  const [command, ...args] = argv;

  switch (command) {
    case "setup":
      if (args.length > 0) throw usageError("setup does not accept arguments.");
      await runSetup();
      break;
    case "clone":
      await runClone(args);
      break;
    case "configure":
      await runConfigure(args);
      break;
    case "credential":
      await runCredential(args);
      break;
    default:
      throw usageError(`Unknown command: ${command}`);
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof ConfigNotFoundError) {
    console.error(
      "No config found. Run:\n\n  npx @snazzah/gh-app-access setup",
    );
  } else if (error instanceof GitHubAccessError) {
    console.error(error.message);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
}
