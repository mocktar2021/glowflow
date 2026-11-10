import { fileURLToPath } from "node:url";
import path from "node:path";

const origin = "https://glowflow.mocktar.com";
const locales = ["fr", "en", "es"];
const publicPages = ["", "/salons", "/salons/locations/US", "/salons/locations/US/Greensboro", "/login", "/privacy", "/terms", "/support"];

function expectedRedirect(response, target, route) {
  if (![307, 308].includes(response.status)) throw new Error(`${route}: expected an authentication or locale redirect, got ${response.status}`);
  const location = response.headers.get("location");
  if (location !== target && location !== `${origin}${target}`) throw new Error(`${route}: redirect did not stay on the expected GlowFlow route`);
}

async function readOnlyGet(route, fetchImpl, clock) {
  const startedAt = clock();
  let response;
  try {
    response = await fetchImpl(`${origin}${route}`, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Provider and network exceptions may contain URLs, tokens, or request data.
    throw new Error(`${route}: anonymous GET failed`);
  }
  const elapsed = clock() - startedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error(`${route}: invalid probe clock`);
  return { response, duration_ms: Math.ceil(elapsed) };
}

export async function probePublicRelease(fetchImpl = fetch, clock = () => performance.now()) {
  const { response: root, duration_ms: rootDuration } = await readOnlyGet("/", fetchImpl, clock);
  expectedRedirect(root, "/fr", "/");

  const checks = [{ route: "/", status: root.status, duration_ms: rootDuration }];
  for (const locale of locales) {
    for (const page of publicPages) {
      const route = `/${locale}${page}`;
      const { response, duration_ms } = await readOnlyGet(route, fetchImpl, clock);
      if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
        throw new Error(`${route}: expected a public HTML 200, got ${response.status}`);
      }
      checks.push({ route, status: response.status, duration_ms });
    }

    const privateRoute = `/${locale}/dashboard/clients`;
    const { response, duration_ms } = await readOnlyGet(privateRoute, fetchImpl, clock);
    expectedRedirect(response, `/${locale}/login`, privateRoute);
    checks.push({ route: privateRoute, status: response.status, duration_ms });
  }

  return { origin, checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  probePublicRelease().then(
    result => console.log(JSON.stringify(result)),
    error => {
      console.error(`Public release smoke failed: ${error?.message || "unknown error"}`);
      process.exitCode = 1;
    },
  );
}
