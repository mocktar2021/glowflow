import { fileURLToPath } from "node:url";
import path from "node:path";

const origin = "https://glowflow.mocktar.com";
const locales = ["fr", "en", "es"];
const publicPages = ["", "/salons", "/login", "/privacy", "/terms", "/support"];

function expectedRedirect(response, target, route) {
  if (![307, 308].includes(response.status)) throw new Error(`${route}: expected an authentication or locale redirect, got ${response.status}`);
  const location = response.headers.get("location");
  if (location !== target && location !== `${origin}${target}`) throw new Error(`${route}: redirect did not stay on the expected GlowFlow route`);
}

async function readOnlyGet(route, fetchImpl) {
  const response = await fetchImpl(`${origin}${route}`, {
    method: "GET",
    redirect: "manual",
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  return response;
}

export async function probePublicRelease(fetchImpl = fetch) {
  const root = await readOnlyGet("/", fetchImpl);
  expectedRedirect(root, "/fr", "/");

  const checks = [{ route: "/", status: root.status }];
  for (const locale of locales) {
    for (const page of publicPages) {
      const route = `/${locale}${page}`;
      const response = await readOnlyGet(route, fetchImpl);
      if (response.status !== 200 || !response.headers.get("content-type")?.toLowerCase().startsWith("text/html")) {
        throw new Error(`${route}: expected a public HTML 200, got ${response.status}`);
      }
      checks.push({ route, status: response.status });
    }

    const privateRoute = `/${locale}/dashboard/clients`;
    const response = await readOnlyGet(privateRoute, fetchImpl);
    expectedRedirect(response, `/${locale}/login`, privateRoute);
    checks.push({ route: privateRoute, status: response.status });
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
