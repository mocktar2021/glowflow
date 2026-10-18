import { NextResponse } from "next/server";

import { ensureOwnerWorkspace } from "@/lib/auth";
import { authCopy } from "@/lib/auth-copy";
import { isLocale } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null, origin: string) {
  const fallback = new URL("/fr/dashboard", origin);
  if (
    !value?.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f\u007f]|%(?:2f|5c)/i.test(value)
  ) return fallback;

  try {
    const destination = new URL(value, origin);
    return destination.origin === origin ? destination : fallback;
  } catch {
    return fallback;
  }
}

function callbackLocale(next: URL) {
  const segment = next.pathname.split("/")[1] ?? "";
  return isLocale(segment) ? segment : "fr";
}

function loginError(origin: string, locale: "fr" | "en" | "es", message: string) {
  const destination = new URL(`/${locale}/login`, origin);
  destination.searchParams.set("error", message);
  return NextResponse.redirect(destination);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"), url.origin);
  const locale = callbackLocale(next);
  const notices = authCopy[locale].notices;

  if (!code) {
    return loginError(url.origin, locale, notices.invalidLink);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return loginError(url.origin, locale, notices.expiredLink);
  }

  const workspace = await ensureOwnerWorkspace();
  if (workspace.error) {
    return loginError(url.origin, locale, notices.workspaceNotReady);
  }

  return NextResponse.redirect(next);
}
