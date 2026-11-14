import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function localUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} is unavailable`); }
  requireCondition(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash,
  `${name} must be a loopback-only URL`);
  return url;
}

function statusVariables(filename) {
  requireCondition(typeof filename === "string" && filename.length > 0,
    "local Supabase status file is required");
  const values = {};
  for (const line of readFileSync(filename, "utf8").split(/\r?\n/)) {
    const match = /^(?:export )?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

async function recoveryLink(mailpit, apiOrigin) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(new URL("/view/latest.txt", mailpit));
    if (response.ok) {
      const body = await response.text();
      const links = body.match(/https?:\/\/[^\s<>"']+/g) || [];
      for (const text of links) {
        let url;
        try { url = new URL(text.replace(/[).,;]+$/, "")); } catch { continue; }
        if (url.origin === apiOrigin && url.pathname === "/auth/v1/verify"
          && url.searchParams.get("type") === "recovery") return url;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("local Mailpit did not contain a recovery link");
}

const status = statusVariables(process.argv[2]);
const api = localUrl(status.API_URL, "local Auth API");
const mailpit = localUrl(status.MAILPIT_URL, "local Mailpit");
const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
requireCondition(typeof publicKey === "string" && publicKey.length > 20,
  "local publishable key is unavailable");
const client = () => createClient(api.origin, publicKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const email = `glow9-${randomUUID()}@example.invalid`;
const legacyStored = `Gl0w!${randomBytes(16).toString("hex")}`;
const originalInput = `  ${legacyStored}  `;
const replacement = `  Gl0w!${randomBytes(16).toString("hex")}  `;

// The old owner action trimmed this input before calling signUp. Create only
// the resulting stored credential; every account and email stays local.
const signup = await client().auth.signUp({ email, password: legacyStored });
requireCondition(!signup.error && signup.data.user, "local legacy signup failed");

const spacedAttempt = await client().auth.signInWithPassword({ email, password: originalInput });
requireCondition(Boolean(spacedAttempt.error) && !spacedAttempt.data.session,
  "legacy account unexpectedly accepted the old spaced input");
const legacyAttempt = await client().auth.signInWithPassword({ email, password: legacyStored });
requireCondition(!legacyAttempt.error && legacyAttempt.data.session,
  "legacy account did not accept its stored password");

const reset = await client().auth.resetPasswordForEmail(email);
requireCondition(!reset.error, "local password recovery request failed");
const link = await recoveryLink(mailpit, api.origin);
const verification = await fetch(link, { redirect: "manual" });
requireCondition(verification.status >= 300 && verification.status < 400,
  "local recovery link was not accepted");
const location = verification.headers.get("location");
requireCondition(Boolean(location), "local recovery redirect is missing");
let redirect;
try { redirect = new URL(location); } catch { throw new Error("local recovery callback is malformed"); }
localUrl(redirect.origin, "local recovery callback");
const fragment = new URLSearchParams(redirect.hash.slice(1));
const accessToken = fragment.get("access_token");
const refreshToken = fragment.get("refresh_token");
requireCondition(Boolean(accessToken && refreshToken), "local recovery session is missing");

const recovered = client();
const session = await recovered.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
requireCondition(!session.error && session.data.session, "local recovery session could not be established");
const changed = await recovered.auth.updateUser({ password: replacement });
requireCondition(!changed.error, "local exact password update failed");
await recovered.auth.signOut();

const exactAttempt = await client().auth.signInWithPassword({ email, password: replacement });
requireCondition(!exactAttempt.error && exactAttempt.data.session,
  "local exact replacement password was not accepted");
const trimmedAttempt = await client().auth.signInWithPassword({ email, password: replacement.trim() });
requireCondition(Boolean(trimmedAttempt.error) && !trimmedAttempt.data.session,
  "local Auth unexpectedly accepted a trimmed replacement password");

console.log("GLOW-9 disposable local Auth and Mailpit legacy recovery passed");
