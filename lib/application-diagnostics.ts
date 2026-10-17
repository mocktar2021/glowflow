/** Server-only application diagnostics. Never pass request or provider objects to logs. */
const routes = ["public_booking"] as const;
const methods = ["GET", "POST"] as const;
const stages = ["availability", "create", "confirmation", "enrichment"] as const;
const codes = ["database_error", "missing_confirmation", "unexpected_error"] as const;

export type ApplicationRoute = typeof routes[number];
export type ApplicationMethod = typeof methods[number];
export type ApplicationStage = typeof stages[number];
export type ApplicationCode = typeof codes[number];

export function reportApplicationFailure(
  route: ApplicationRoute,
  method: ApplicationMethod,
  stage: ApplicationStage,
  code: ApplicationCode,
): string | null {
  // Runtime allowlists also protect JavaScript callers. Never coerce or serialize inputs.
  const safeRoute = routes.includes(route) ? route : "unknown";
  const safeMethod = methods.includes(method) ? method : "unknown";
  const safeStage = stages.includes(stage) ? stage : "unknown";
  const safeCode = codes.includes(code) ? code : "unexpected_error";
  try {
    const requestId = crypto.randomUUID();
    console.error(JSON.stringify({
      event: "glowflow_application_failure",
      request_id: requestId,
      route: safeRoute,
      method: safeMethod,
      stage: safeStage,
      code: safeCode,
    }));
    return requestId;
  } catch {
    // Logging must never change the API's failure response.
    return null;
  }
}
