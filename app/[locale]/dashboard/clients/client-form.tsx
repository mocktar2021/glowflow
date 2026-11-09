"use client";

import { useActionState } from "react";

import type { ClientProfile } from "@/lib/clients";
import type { Locale } from "@/lib/i18n";
import { saveClient } from "./actions";
import { cardClass, copy, inputClass } from "./copy";

export function ClientForm({ locale, client }: { locale: Locale; client?: ClientProfile }) {
  const labels = copy[locale];
  const [state, action, pending] = useActionState(saveClient.bind(null, locale, client?.id ?? null), { error: null, saved: false });
  return <section className={cardClass}>
    <h2 className="text-xl font-semibold">{client ? labels.profile : labels.add}</h2>
    <form action={action} className="mt-5 space-y-4">
      <label className="block text-sm font-medium">{labels.name}
        <input name="full_name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={client?.full_name ?? ""} className={inputClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">{labels.email}
          <input name="email" type="email" maxLength={160} autoComplete="email" defaultValue={client?.email ?? ""} className={inputClass} />
        </label>
        <label className="block text-sm font-medium">{labels.phone}
          <input name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={client?.phone ?? ""} className={inputClass} />
        </label>
      </div>
      <label className="block text-sm font-medium">{labels.language}
        <select name="preferred_locale" defaultValue={client?.preferred_locale ?? locale} className={inputClass}>
          <option value="fr">{labels.french}</option><option value="en">{labels.english}</option><option value="es">{labels.spanish}</option>
        </select>
      </label>
      <label className="block text-sm font-medium">{labels.notes}
        <textarea name="notes" rows={4} maxLength={2000} defaultValue={client?.notes ?? ""} className={inputClass} />
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{state.error === "invalid" ? labels.invalid : labels.failed}</p>}
      {state.saved && <p role="status" className="text-sm text-green-800 dark:text-green-300">{labels.saved}</p>}
      <button disabled={pending} className="min-h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">{pending ? labels.saving : labels.save}</button>
    </form>
  </section>;
}
