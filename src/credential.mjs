import { ConfigNotFoundError, loadConfig } from "./config.mjs";
import { parseRepo } from "./git.mjs";
import { mintInstallationToken } from "./github-app.mjs";

export function parseCredentialInput(text) {
  const fields = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) {
      fields[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return fields;
}

export function parseCredentialRepo(fields) {
  if (fields.protocol !== "https" || fields.host?.toLowerCase() !== "github.com") {
    return null;
  }
  if (!fields.path) return null;

  try {
    return parseRepo(fields.path.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

async function readStream(stream) {
  let text = "";
  stream.setEncoding("utf8");
  for await (const chunk of stream) text += chunk;
  return text;
}

export async function answerCredentialRequest({ operation, input }) {
  if (operation !== "get") return;

  const repo = parseCredentialRepo(parseCredentialInput(await readStream(input)));
  if (!repo) return;

  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    if (error instanceof ConfigNotFoundError) return;
    throw error;
  }

  const token = await mintInstallationToken({ ...config, ...repo });
  process.stdout.write(`username=x-access-token\npassword=${token}\n\n`);
}
