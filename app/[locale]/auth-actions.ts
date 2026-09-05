"use server";

import { redirect } from "next/navigation";

import { ensureOwnerWorkspace, safeLocale } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function authUrl(locale: string, path: string, key?: string, message?: string) {
  const url = `/${locale}/${path}`;
  return key && message ? `${url}?${key}=${encodeURIComponent(message)}` : url;
}

export async function signIn(localeValue: string, formData: FormData) {
  const locale = safeLocale(localeValue);
  const email = value(formData, "email");
  const password = value(formData, "password");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(authUrl(locale, "login", "error", "Invalid email or password."));
  }

  const workspace = await ensureOwnerWorkspace();
  if (workspace.error) {
    redirect(authUrl(locale, "login", "error", "Your salon workspace is not ready."));
  }

  redirect(`/${locale}/dashboard`);
}

export async function signUp(localeValue: string, formData: FormData) {
  const locale = safeLocale(localeValue);
  const fullName = value(formData, "full_name");
  const salonName = value(formData, "salon_name");
  const email = value(formData, "email");
  const password = value(formData, "password");
  const countryCode = value(formData, "country_code").toUpperCase();
  const timeZone = value(formData, "time_zone");
  const addressLine1 = value(formData, "address_line1");
  const city = value(formData, "city");
  const postalCode = value(formData, "postal_code");
  const administrativeArea = value(formData, "administrative_area");
  const salonSlug = salonName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (
    fullName.length < 2 ||
    salonName.length < 2 ||
    password.length < 8 ||
    countryCode.length !== 2 ||
    !timeZone ||
    addressLine1.length < 3 ||
    city.length < 2 ||
    !postalCode
  ) {
    redirect(authUrl(locale, "register", "error", "Complete every field. Passwords need 8 characters."));
  }

  const supabase = await createClient();
  const origin = process.env.GLOWFLOW_APP_URL ?? "https://glowflow.mocktar.com";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=/${locale}/dashboard`,
      data: {
        full_name: fullName,
        salon_name: salonName,
        salon_slug: salonSlug,
        locale,
        country_code: countryCode,
        time_zone: timeZone,
        address_line1: addressLine1,
        city,
        postal_code: postalCode,
        administrative_area: administrativeArea,
      },
    },
  });

  if (error) {
    redirect(authUrl(locale, "register", "error", error.message));
  }

  if (data.session) {
    const workspace = await ensureOwnerWorkspace();
    if (!workspace.error) redirect(`/${locale}/dashboard`);
  }

  redirect(authUrl(locale, "login", "message", "Check your email to confirm your GlowFlow account."));
}

export async function requestPasswordReset(localeValue: string, formData: FormData) {
  const locale = safeLocale(localeValue);
  const email = value(formData, "email");
  const origin = process.env.GLOWFLOW_APP_URL ?? "https://glowflow.mocktar.com";
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/${locale}/update-password`,
  });

  redirect(authUrl(locale, "forgot-password", "message", "If an account exists, a reset link is on its way."));
}

export async function updatePassword(localeValue: string, formData: FormData) {
  const locale = safeLocale(localeValue);
  const password = value(formData, "password");

  if (password.length < 8) {
    redirect(authUrl(locale, "update-password", "error", "Use at least 8 characters."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(authUrl(locale, "update-password", "error", error.message));
  }

  redirect(authUrl(locale, "login", "message", "Password updated. Sign in with your new password."));
}

export async function signOut(localeValue: string) {
  const locale = safeLocale(localeValue);
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/${locale}/login`);
}
