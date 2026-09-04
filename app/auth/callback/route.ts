import { NextResponse } from "next/server";

import { ensureOwnerWorkspace } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function safeNext(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/fr/dashboard";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(new URL("/fr/login?error=Invalid+confirmation+link.", url.origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL("/fr/login?error=Confirmation+link+expired.", url.origin));
  }

  const workspace = await ensureOwnerWorkspace();
  if (workspace.error) {
    return NextResponse.redirect(new URL("/fr/login?error=Salon+workspace+setup+failed.", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
