import { pathToFileURL } from "node:url";
const workflow = "mocktar2021/glowflow/.github/workflows/glow56-qa-cleanup.yml@refs/heads/master";
const endpoint = "https://glowflow.mocktar.com/api/internal/glow56-cleanup";
const audience = "glowflow-qa-cleanup-v1";

export async function trigger(env = process.env, fetchImpl = globalThis.fetch, log = console.log) {
  try {
    if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REPOSITORY !== "mocktar2021/glowflow"
      || env.GITHUB_REF !== "refs/heads/master" || env.GITHUB_EVENT_NAME !== "schedule"
      || env.GITHUB_WORKFLOW_REF !== workflow
      || typeof env.ACTIONS_ID_TOKEN_REQUEST_TOKEN !== "string"
      || env.ACTIONS_ID_TOKEN_REQUEST_TOKEN.length < 20) throw new Error("scope");
    const requestUrl = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
    if (requestUrl.protocol !== "https:"
      || !requestUrl.hostname.endsWith(".actions.githubusercontent.com")
      || requestUrl.username || requestUrl.password || requestUrl.hash) throw new Error("scope");
    requestUrl.searchParams.set("audience", audience);
    const tokenResponse = await fetchImpl(requestUrl, {
      headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5_000),
    });
    if (!tokenResponse.ok) throw new Error("identity");
    const tokenBody = await tokenResponse.text();
    if (tokenBody.length > 20_000) throw new Error("identity");
    const token = JSON.parse(tokenBody).value;
    if (typeof token !== "string" || token.length < 100 || token.length > 16_384) {
      throw new Error("identity");
    }
    const response = await fetchImpl(endpoint, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(55_000),
    });
    if (response.status !== 204) throw new Error("cleanup");
    log("GlowFlow QA cleanup and independent signal accepted.");
    return 0;
  } catch {
    log("GlowFlow QA cleanup or independent signal unavailable.");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await trigger();
}
