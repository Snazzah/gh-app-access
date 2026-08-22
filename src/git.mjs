import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CREDENTIAL_HELPER = "!npx -y @snazzah/gh-app-access credential";

function validateRepoParts(owner, repo) {
  const cleanRepo = repo.endsWith(".git") ? repo.slice(0, -4) : repo;
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner) ||
    owner.endsWith("-") ||
    !/^[A-Za-z0-9._-]+$/.test(cleanRepo) ||
    cleanRepo === "." ||
    cleanRepo === ".."
  ) {
    throw new Error("Repository must be a GitHub owner/repo pair.");
  }
  return { owner, repo: cleanRepo };
}

export function parseRepo(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("Repository must be a GitHub owner/repo pair.");
  }

  const value = input.trim();
  const sshMatch = /^git@github\.com:([^/]+)\/(.+)$/.exec(value);
  if (sshMatch) {
    return validateRepoParts(sshMatch[1], sshMatch[2]);
  }

  if (/^https?:\/\//i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Repository URL is invalid.");
    }
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
      throw new Error("Only github.com HTTPS remotes are supported right now.");
    }
    const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length !== 2) {
      throw new Error("Repository URL must point to github.com/owner/repo.");
    }
    return validateRepoParts(parts[0], parts[1]);
  }

  const parts = value.split("/");
  if (parts.length !== 2) {
    throw new Error("Repository must be a GitHub owner/repo pair.");
  }
  return validateRepoParts(parts[0], parts[1]);
}

function repositoryUrl(owner, repo) {
  return `https://github.com/${owner}/${repo}.git`;
}

async function captureGit(args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      encoding: "utf8",
      windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

async function runGit(args, { env = process.env, allowExitCodes = [] } = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0 || allowExitCodes.includes(code)) {
        resolve();
      } else if (signal) {
        reject(new Error(`git was terminated by ${signal}.`));
      } else {
        reject(new Error(`git ${args.join(" ")} exited with code ${code}.`));
      }
    });
  });
}

async function withAskPass(token, action) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gh-app-access-"));
  const isWindows = process.platform === "win32";
  const askPassPath = path.join(directory, isWindows ? "askpass.cmd" : "askpass.sh");
  const script = isWindows
    ? '@echo off\r\nset "prompt=%~1"\r\nif /I "%prompt:~0,8%"=="Username" (\r\n  echo x-access-token\r\n) else (\r\n  echo %GH_APP_ACCESS_TOKEN%\r\n)\r\n'
    : '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "x-access-token" ;;\n  *) printf "%s\\n" "$GH_APP_ACCESS_TOKEN" ;;\nesac\n';

  try {
    await writeFile(askPassPath, script, { encoding: "utf8", mode: 0o700 });
    if (!isWindows) await chmod(askPassPath, 0o700);
    await action({
      ...process.env,
      GH_APP_ACCESS_TOKEN: token,
      GIT_ASKPASS: askPassPath,
      GIT_TERMINAL_PROMPT: "0",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function inspectRepository(directory) {
  const root = await captureGit(["-C", path.resolve(directory), "rev-parse", "--show-toplevel"]);
  const origin = await captureGit(["-C", root, "remote", "get-url", "origin"]);
  return { root, origin, repo: parseRepo(origin) };
}

export async function configureRepository({ root, owner, repo }) {
  await runGit(["-C", root, "remote", "set-url", "origin", repositoryUrl(owner, repo)]);
  await runGit(
    ["-C", root, "config", "--local", "--unset-all", "credential.helper"],
    { allowExitCodes: [5] },
  );
  await runGit(["-C", root, "config", "--local", "--add", "credential.helper", ""]);
  await runGit([
    "-C",
    root,
    "config",
    "--local",
    "--add",
    "credential.helper",
    CREDENTIAL_HELPER,
  ]);
  await runGit(["-C", root, "config", "--local", "credential.useHttpPath", "true"]);
}

export async function cloneRepository({ owner, repo, directory, token }) {
  const args = ["clone", repositoryUrl(owner, repo)];
  if (directory) args.push(directory);

  await withAskPass(token, (env) => runGit(args, { env }));
  const target = path.resolve(directory || repo);
  return captureGit(["-C", target, "rev-parse", "--show-toplevel"]);
}
