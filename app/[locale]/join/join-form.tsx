"use client";

import { useActionState, useEffect, useState } from "react";

import { buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import type { Locale } from "@/lib/i18n";
import { validStaffInvitationToken } from "@/lib/staff-invitations";

import {
  acceptStaffInvitation,
  signInToAcceptInvitation,
  signUpToAcceptInvitation,
  type JoinState,
} from "./actions";

const copy = {
  fr: {
    missing: "Ce lien d'invitation est incomplet ou invalide. Ouvrez à nouveau le lien reçu par e-mail.",
    unavailable: "Impossible d'utiliser cette invitation. Vérifiez votre e-mail, ou demandez un nouveau lien au propriétaire du salon.",
    confirmed: "Votre adresse e-mail doit être vérifiée avant de rejoindre le salon.",
    name: "Nom complet", email: "Adresse e-mail", password: "Mot de passe",
    accept: "Rejoindre le salon", signIn: "Se connecter et rejoindre",
    create: "Créer un compte et rejoindre", existing: "Vous avez déjà un compte ?",
    new: "Vous n'avez pas de compte ?", verify: "Après avoir vérifié votre e-mail, ouvrez à nouveau le lien d'invitation d'origine.",
  },
  en: {
    missing: "This invitation link is incomplete or invalid. Open the link from your email again.",
    unavailable: "This invitation could not be used. Verify your email, or ask the salon owner for a new link.",
    confirmed: "Your email address must be verified before you can join the salon.",
    name: "Full name", email: "Email address", password: "Password",
    accept: "Join the salon", signIn: "Sign in and join",
    create: "Create account and join", existing: "Already have an account?",
    new: "Need an account?", verify: "After verifying your email, reopen the original invitation link.",
  },
  es: {
    missing: "Este enlace de invitación está incompleto o no es válido. Abre de nuevo el enlace de tu correo.",
    unavailable: "No se pudo usar esta invitación. Verifica tu correo o pide un enlace nuevo al propietario del salón.",
    confirmed: "Debes verificar tu correo electrónico antes de unirte al salón.",
    name: "Nombre completo", email: "Correo electrónico", password: "Contraseña",
    accept: "Unirse al salón", signIn: "Iniciar sesión y unirse",
    create: "Crear cuenta y unirse", existing: "¿Ya tienes una cuenta?",
    new: "¿Necesitas una cuenta?", verify: "Después de verificar tu correo, vuelve a abrir el enlace de invitación original.",
  },
} as const;

const initialState: JoinState = { error: null };

function ErrorNotice({ state, label }: { state: JoinState; label: string }) {
  return state.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{label}</p> : null;
}

function NameField({ label, initialName }: { label: string; initialName: string }) {
  return <label className="block text-sm font-medium">{label}<input className={`${inputClass} mt-2`} name="full_name" autoComplete="name" defaultValue={initialName} minLength={2} maxLength={120} required /></label>;
}

export function JoinForm({ locale, signedIn, confirmed, initialName }: {
  locale: Locale;
  signedIn: boolean;
  confirmed: boolean;
  initialName: string;
}) {
  const labels = copy[locale];
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [acceptState, acceptAction, accepting] = useActionState(acceptStaffInvitation.bind(null, locale), initialState);
  const [signInState, signInAction, signingIn] = useActionState(signInToAcceptInvitation.bind(null, locale), initialState);
  const [signUpState, signUpAction, signingUp] = useActionState(signUpToAcceptInvitation.bind(null, locale), initialState);

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const candidate = fragment.get("token") ?? "";
    setToken(validStaffInvitationToken(candidate) ? candidate : "");
    // Keep the raw token out of the visible URL and referrer after first load.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  if (token === null) return null;
  if (!token) return <p role="alert" className="text-sm leading-6">{labels.missing}</p>;
  if (signedIn && !confirmed) return <p role="alert" className="text-sm leading-6">{labels.confirmed} {labels.verify}</p>;

  if (signedIn) return (
    <form action={acceptAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <ErrorNotice state={acceptState} label={labels.unavailable} />
      <NameField label={labels.name} initialName={initialName} />
      <button className={buttonClass} disabled={accepting} type="submit">{labels.accept}</button>
    </form>
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-3 text-sm">
        <button type="button" aria-pressed={mode === "signIn"} onClick={() => setMode("signIn")} className="min-h-11 rounded-full border border-[#dfd2c1] px-4 aria-pressed:bg-[#f4ede3] dark:border-white/15 dark:aria-pressed:bg-white/10">{labels.existing}</button>
        <button type="button" aria-pressed={mode === "signUp"} onClick={() => setMode("signUp")} className="min-h-11 rounded-full border border-[#dfd2c1] px-4 aria-pressed:bg-[#f4ede3] dark:border-white/15 dark:aria-pressed:bg-white/10">{labels.new}</button>
      </div>
      {mode === "signIn" ? (
        <form action={signInAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <ErrorNotice state={signInState} label={labels.unavailable} />
          <NameField label={labels.name} initialName="" />
          <label className="block text-sm font-medium">{labels.email}<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
          <label className="block text-sm font-medium">{labels.password}<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="current-password" required /></label>
          <button className={buttonClass} disabled={signingIn} type="submit">{labels.signIn}</button>
        </form>
      ) : (
        <form action={signUpAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <ErrorNotice state={signUpState} label={labels.unavailable} />
          <NameField label={labels.name} initialName="" />
          <label className="block text-sm font-medium">{labels.email}<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
          <label className="block text-sm font-medium">{labels.password}<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
          <button className={buttonClass} disabled={signingUp} type="submit">{labels.create}</button>
          <p className="text-sm leading-6 text-slate-500 dark:text-stone-400">{labels.verify}</p>
        </form>
      )}
    </div>
  );
}
