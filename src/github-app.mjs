import { createPrivateKey } from "node:crypto";

import { SignJWT } from "jose";

const API_ROOT = "https://api.github.com";
const API_VERSION = "2022-11-28";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = 100;

export class GitHubAccessError extends Error {
  constructor(owner, repo) {
    super(
      `Could not access ${owner}/${repo} with this GitHub App.\n` +
        "Make sure the app is installed on the repository and has Contents: Read-only permission.",
    );
    this.name = "GitHubAccessError";
  }
}

export async function createAppJwt({ appId, privateKey, now = Date.now() }) {
  const nowSeconds = Math.floor(now / 1000);
  const signingKey = createPrivateKey(privateKey);

  return new SignJWT()
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(nowSeconds - 60)
    .setExpirationTime(nowSeconds + 9 * 60)
    .setIssuer(String(appId))
    .sign(signingKey);
}

async function githubRequest(pathname, { appJwt, method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(`${API_ROOT}${pathname}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt}`,
        "Content-Type": "application/json",
        "User-Agent": "gh-app-access",
        "X-GitHub-Api-Version": API_VERSION,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("GitHub API request timed out after 30 seconds.");
    }
    throw new Error(`Could not reach the GitHub API: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof responseBody.message === "string"
        ? responseBody.message
        : `GitHub API returned HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return responseBody;
}

async function githubPaginate(pathname, options) {
  const items = [];
  let page = 1;

  while (page <= MAX_PAGES) {
    const separator = pathname.includes("?") ? "&" : "?";
    const body = await githubRequest(`${pathname}${separator}per_page=100&page=${page}`, options);
    if (!Array.isArray(body) || body.length === 0) break;
    items.push(...body);
    if (body.length < 100) break;
    page += 1;
  }

  return items;
}

export async function listAppInstallations({ appId, privateKey }) {
  const appJwt = await createAppJwt({ appId, privateKey });
  return githubPaginate("/app/installations", { appJwt });
}

export async function listInstallationRepositories({ appId, privateKey, installationId }) {
  const appJwt = await createAppJwt({ appId, privateKey });
  return githubPaginate(
    `/app/installations/${encodeURIComponent(installationId)}/repositories`,
    { appJwt },
  );
}

export async function mintInstallationToken({ appId, privateKey, owner, repo }) {
  const appJwt = await createAppJwt({ appId, privateKey });
  let installation;

  try {
    installation = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
      { appJwt },
    );
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      throw new GitHubAccessError(owner, repo);
    }
    throw error;
  }

  let tokenResponse;
  try {
    tokenResponse = await githubRequest(
      `/app/installations/${encodeURIComponent(installation.id)}/access_tokens`,
      {
        appJwt,
        method: "POST",
        body: {
          repositories: [repo],
          permissions: { contents: "read" },
        },
      },
    );
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      throw new GitHubAccessError(owner, repo);
    }
    throw error;
  }

  if (typeof tokenResponse.token !== "string" || !tokenResponse.token) {
    throw new Error("GitHub did not return an installation token.");
  }

  return tokenResponse.token;
}
