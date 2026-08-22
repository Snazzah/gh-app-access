import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  password,
  select,
  text,
} from "@clack/prompts";

function canceled(value) {
  if (!isCancel(value)) return false;
  cancel("Setup canceled. Existing configuration was not changed.");
  return true;
}

export async function promptForSetup({ hasExistingConfig, validatePrivateKey }) {
  intro(
    "gh-app-access setup\n\n" +
      "Make a new GitHub App before continuing:\n" +
      "https://github.com/settings/apps/new",
  );

  if (hasExistingConfig) {
    const overwrite = await confirm({
      message: "Replace the existing GitHub App configuration?",
      initialValue: false,
    });
    if (canceled(overwrite) || !overwrite) {
      if (!isCancel(overwrite)) cancel("Setup canceled. Existing configuration was not changed.");
      return null;
    }
  }

  const appId = await text({
    message: "GitHub App ID",
    validate(value) {
      if (!/^\d+$/.test(value.trim())) return "Enter the numeric GitHub App ID.";
    },
  });
  if (canceled(appId)) return null;

  const keyMode = await select({
    message: "Private key input",
    options: [
      { value: "path", label: "Read from .pem path" },
      { value: "paste", label: "Paste key" },
    ],
  });
  if (canceled(keyMode)) return null;

  let privateKey;
  if (keyMode === "path") {
    const keyPath = await text({
      message: "Path to the GitHub App .pem file",
      validate(value) {
        if (!value.trim()) return "Enter a path to the .pem file.";
      },
    });
    if (canceled(keyPath)) return null;
    privateKey = await readFile(path.resolve(keyPath.trim()), "utf8");
  } else {
    const pasted = await password({
      message: "Paste the private key (literal \\n sequences are accepted)",
      mask: "*",
      validate(value) {
        if (!value.trim()) return "Paste the private key.";
      },
    });
    if (canceled(pasted)) return null;
    privateKey = pasted.replace(/\\n/g, "\n");
  }

  if (!privateKey.includes("PRIVATE KEY")) {
    throw new Error("The supplied file does not contain a private key.");
  }

  try {
    await validatePrivateKey({ appId: appId.trim(), privateKey });
  } catch {
    throw new Error("The supplied private key is not a valid RSA private key.");
  }

  return { appId: appId.trim(), privateKey };
}

export function finishSetup() {
  outro(
    "Setup complete. Next: npx @snazzah/gh-app-access clone owner/private-repo",
  );
}
