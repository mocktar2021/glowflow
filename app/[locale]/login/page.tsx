import Link from "next/link";
import { notFound } from "next/navigation";

import { AuthMessage, AuthShell, buttonClass, inputClass } from "@/components/glowflow/auth-shell";
import { isLocale } from "@/lib/i18n";
import { signIn } from "../auth-actions";

const copy = {
  fr: {
    title: "Heureux de vous revoir",
    subtitle: "Connectez-vous pour gérer votre salon, vos clients et vos rendez-vous.",
    email: "Adresse e-mail",
    password: "Mot de passe",
    submit: "Se connecter",
    forgot: "Mot de passe oublié ?",
    register: "Créer un compte",
  },
  en: {
    title: "Welcome back",
    subtitle: "Sign in to manage your salon, clients, and appointments.",
    email: "Email address",
    password: "Password",
    submit: "Sign in",
    forgot: "Forgot password?",
    register: "Create account",
  },
  es: {
    title: "Te damos la bienvenida",
    subtitle: "Inicia sesión para gestionar tu salón, clientes y citas.",
    email: "Correo electrónico",
    password: "Contraseña",
    submit: "Iniciar sesión",
    forgot: "¿Olvidaste tu contraseña?",
    register: "Crear una cuenta",
  },
} as const;

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ error?: string; message?: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const notices = await searchParams;
  const labels = copy[locale];

  return (
    <AuthShell locale={locale} title={labels.title} subtitle={labels.subtitle}>
      <AuthMessage {...notices} />
      <form action={signIn.bind(null, locale)} className="space-y-4">
        <label className="block text-sm font-medium">{labels.email}<input className={`${inputClass} mt-2`} name="email" type="email" autoComplete="email" required /></label>
        <label className="block text-sm font-medium">{labels.password}<input className={`${inputClass} mt-2`} name="password" type="password" autoComplete="current-password" required /></label>
        <button className={buttonClass} type="submit">{labels.submit}</button>
      </form>
      <div className="mt-5 flex justify-between text-sm">
        <Link className="min-h-11 py-3 pr-3 text-[#9a622f] hover:underline" href={`/${locale}/forgot-password`}>{labels.forgot}</Link>
        <Link className="min-h-11 py-3 pl-3 text-right font-semibold hover:underline" href={`/${locale}/register`}>{labels.register}</Link>
      </div>
    </AuthShell>
  );
}
