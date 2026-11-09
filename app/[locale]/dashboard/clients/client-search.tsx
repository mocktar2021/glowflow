"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { ClientSummary } from "@/lib/clients";
import type { Locale } from "@/lib/i18n";
import { searchClients } from "./actions";
import { cardClass, copy, inputClass } from "./copy";

export function ClientSearch({ locale, initialRows }: { locale: Locale; initialRows: ClientSummary[] }) {
  const labels = copy[locale];
  const [state, action, pending] = useActionState(searchClients.bind(null, locale), { error: null, rows: initialRows });
  return <section className={cardClass}>
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="min-w-0 flex-1 text-sm font-medium">{labels.search}
        <input name="search" type="search" maxLength={80} className={inputClass} />
      </label>
      <button disabled={pending} className="min-h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60">{pending ? labels.searching : labels.searchButton}</button>
    </form>
    {state.error ? <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{state.error === "invalid" ? labels.invalid : labels.searchFailed}</p> : null}
    <h2 className="mt-7 text-xl font-semibold">{labels.recent}</h2>
    {state.rows.length === 0 ? <p className="mt-3 text-muted-foreground">{labels.empty}</p> :
      <ul className="mt-3 divide-y divide-border">{state.rows.map((client) => <li key={client.id}>
        <Link className="block rounded-xl py-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" href={`/${locale}/dashboard/clients/${client.id}`}>
          <span className="font-semibold">{client.full_name}</span>
          <span className="mt-1 block text-sm text-muted-foreground">{client.email || labels.noEmail} · {client.phone || labels.noPhone}</span>
        </Link>
      </li>)}</ul>}
  </section>;
}
