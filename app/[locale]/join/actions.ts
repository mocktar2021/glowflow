"use server";

import { redirect } from "next/navigation";

import { safeLocale } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { staffInvitationsEnabled, validStaffInvitationToken } from "@/lib/staff-invitations";

export type JoinState = { error: "unavailable" | null };

const unavailable: JoinState = { error: "unavailable" };

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

async function acceptWithSession(
  locale: string,
  formData: FormData,
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<JoinState> {
  const token = field(formData, "token");
  const fullName = field(formData, "full_name");
  if (!validStaffInvitationToken(token) || fullName.length < 2 || fullName.length > 120) {
    return unavailable;
  }

  const { data, error: identityError } = await supabase.auth.getUser();
  if (identityError || !data.user?.email_confirmed_at) return unavailable;

  const { error } = await supabase.rpc("accept_staff_invitation", {
    raw_token: token,
    requested_full_name: fullName,
    requested_locale: locale,
  });
  if (error) return unavailable;

  redirect(`/${locale}/dashboard`);
}

export async function acceptStaffInvitation(
  localeValue: string,
  _previous: JoinState,
  formData: FormData,
): Promise<JoinState> {
  if (!staffInvitationsEnabled()) return unavailable;
  const locale = safeLocale(localeValue);
  return acceptWithSession(locale, formData, await createClient());
}

export async function signInToAcceptInvitation(
  localeValue: string,
  _previous: JoinState,
  formData: FormData,
): Promise<JoinState> {
  if (!staffInvitationsEnabled()) return unavailable;
  const locale = safeLocale(localeValue);
  if (!validStaffInvitationToken(field(formData, "token"))) return unavailable;
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return unavailable;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return unavailable;
  // Never call ensureOwnerWorkspace here. A new staff identity must remain
  // unassigned until the verified-email invitation RPC creates membership.
  return acceptWithSession(locale, formData, supabase);
}

export async function signUpToAcceptInvitation(
  localeValue: string,
  _previous: JoinState,
  formData: FormData,
): Promise<JoinState> {
  if (!staffInvitationsEnabled()) return unavailable;
  const locale = safeLocale(localeValue);
  const token = field(formData, "token");
  const fullName = field(formData, "full_name");
  const email = field(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!validStaffInvitationToken(token) || fullName.length < 2 || fullName.length > 120 || !email || password.length < 8) {
    return unavailable;
  }

  const origin = process.env.GLOWFLOW_APP_URL ?? "https://glowflow.mocktar.com";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/${locale}/join/complete`,
      data: { full_name: fullName, locale, glowflow_account_intent: "staff_invitation" },
    },
  });
  if (error) return unavailable;
  if (data.session) return acceptWithSession(locale, formData, supabase);

  // The token never enters Auth metadata, callback URLs, or browser storage.
  // After confirming email, the recipient reopens the original invite link.
  redirect(`/${locale}/join/complete`);
}
