import { createRemoteJWKSet, jwtVerify } from "jose";

// Only this scheduled job in the existing GlowFlow repository can request a
// cleanup invocation. No database or Healthchecks secret is held by Actions.
export const audience = "glowflow-qa-cleanup-v1";
const issuer = "https://token.actions.githubusercontent.com";
const subject = "repo:mocktar2021/glowflow:ref:refs/heads/master";
const workflow = "mocktar2021/glowflow/.github/workflows/glow56-qa-cleanup.yml@refs/heads/master";
const remoteKeys = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks"),
  { timeoutDuration: 5_000, cooldownDuration: 30_000, cacheMaxAge: 600_000 },
);

export async function verifyScheduleToken(token, keys = remoteKeys) {
  if (typeof token !== "string" || token.length < 100 || token.length > 16_384) return false;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ["RS256"],
      maxTokenAge: "10m",
      clockTolerance: 5,
    });
    return payload.sub === subject
      && payload.repository === "mocktar2021/glowflow"
      && payload.repository_id === "1357531545"
      && payload.repository_owner_id === "94203523"
      && payload.repository_visibility === "public"
      && payload.ref === "refs/heads/master"
      && payload.ref_type === "branch"
      && payload.workflow_ref === workflow
      && payload.environment === undefined
      && payload.event_name === "schedule";
  } catch {
    return false;
  }
}
