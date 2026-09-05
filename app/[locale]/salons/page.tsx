import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, MapPin, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { isLocale, type Locale } from "@/lib/i18n";
import { fallbackMarkets, formatLocalDateTime, formatMoney, marketName } from "@/lib/markets";
import {
  isSalonCategory,
  localizedDescription,
  salonInitials,
  type SalonSearchResult,
} from "@/lib/salon-search";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const copy = {
  fr: {
    eyebrow: "Salons GlowFlow",
    title: "Trouvez votre prochain rendez-vous beauté",
    subtitle: "Recherchez par salon, prestation, produit ou ville.",
    search: "Salon, prestation ou produit",
    searchPlaceholder: "Ex. tresses, manucure, couleur",
    country: "Pays",
    allCountries: "Tous les pays",
    city: "Ville",
    cityPlaceholder: "Ex. Greensboro",
    postal: "Code postal",
    category: "Catégorie",
    allCategories: "Toutes",
    hair: "Coiffure",
    nails: "Ongles",
    other: "Autres",
    maximumPrice: "Prix maximum",
    availableBefore: "Disponible avant",
    submit: "Rechercher",
    reset: "Effacer les filtres",
    results: "salons trouvés",
    oneResult: "salon trouvé",
    from: "À partir de",
    next: "Prochain créneau",
    availabilityUnknown: "Disponibilité sur la page du salon",
    book: "Voir et réserver",
    emptyTitle: "Aucun salon ne correspond à ces critères",
    emptyText: "Modifiez votre ville, votre catégorie ou votre prix maximum.",
    errorTitle: "La recherche est indisponible",
    errorText: "Réessayez dans quelques instants.",
    previous: "Précédent",
    nextPage: "Suivant",
    page: "Page",
    marketplace: "Marketplace beauté",
  },
  en: {
    eyebrow: "GlowFlow salons",
    title: "Find your next beauty appointment",
    subtitle: "Search by salon, service, product, or city.",
    search: "Salon, service, or product",
    searchPlaceholder: "Example: braids, manicure, color",
    country: "Country",
    allCountries: "All countries",
    city: "City",
    cityPlaceholder: "Example: Greensboro",
    postal: "Postal code",
    category: "Category",
    allCategories: "All",
    hair: "Hair",
    nails: "Nails",
    other: "Other",
    maximumPrice: "Maximum price",
    availableBefore: "Available before",
    submit: "Search",
    reset: "Clear filters",
    results: "salons found",
    oneResult: "salon found",
    from: "From",
    next: "Next opening",
    availabilityUnknown: "Availability on the salon page",
    book: "View and book",
    emptyTitle: "No salons match these filters",
    emptyText: "Change your city, category, or maximum price.",
    errorTitle: "Search is unavailable",
    errorText: "Please try again in a moment.",
    previous: "Previous",
    nextPage: "Next",
    page: "Page",
    marketplace: "Beauty marketplace",
  },
  es: {
    eyebrow: "Salones GlowFlow",
    title: "Encuentra tu próxima cita de belleza",
    subtitle: "Busca por salón, servicio, producto o ciudad.",
    search: "Salón, servicio o producto",
    searchPlaceholder: "Ej. trenzas, manicura, color",
    country: "País",
    allCountries: "Todos los países",
    city: "Ciudad",
    cityPlaceholder: "Ej. Greensboro",
    postal: "Código postal",
    category: "Categoría",
    allCategories: "Todas",
    hair: "Cabello",
    nails: "Uñas",
    other: "Otros",
    maximumPrice: "Precio máximo",
    availableBefore: "Disponible antes de",
    submit: "Buscar",
    reset: "Borrar filtros",
    results: "salones encontrados",
    oneResult: "salón encontrado",
    from: "Desde",
    next: "Próxima disponibilidad",
    availabilityUnknown: "Disponibilidad en la página del salón",
    book: "Ver y reservar",
    emptyTitle: "Ningún salón coincide con estos filtros",
    emptyText: "Cambia la ciudad, la categoría o el precio máximo.",
    errorTitle: "La búsqueda no está disponible",
    errorText: "Inténtalo de nuevo en unos instantes.",
    previous: "Anterior",
    nextPage: "Siguiente",
    page: "Página",
    marketplace: "Marketplace de belleza",
  },
} as const;

type SearchParams = Record<string, string | string[] | undefined>;

function value(params: SearchParams, key: string) {
  const item = params[key];
  return Array.isArray(item) ? item[0] ?? "" : item ?? "";
}

function positiveInteger(input: string, fallback: number) {
  const parsed = Number.parseInt(input, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pageHref(locale: Locale, params: SearchParams, page: number) {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (item && key !== "page") query.set(key, item);
  }
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return `/${locale}/salons${suffix ? `?${suffix}` : ""}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const labels = copy[locale];
  return {
    title: labels.title,
    description: labels.subtitle,
    alternates: {
      canonical: `/${locale}/salons`,
      languages: {
        fr: "/fr/salons",
        en: "/en/salons",
        es: "/es/salons",
      },
    },
  };
}

export default async function SalonSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const filters = await searchParams;
  const labels = copy[locale];
  const searchText = value(filters, "q").trim();
  const country = value(filters, "country").toUpperCase();
  const city = value(filters, "city").trim();
  const postalCode = value(filters, "postcode").trim();
  const categoryValue = value(filters, "category");
  const category = isSalonCategory(categoryValue) ? categoryValue : "";
  const maxPriceValue = value(filters, "maxPrice");
  const maximumPrice = maxPriceValue ? positiveInteger(maxPriceValue, 0) : null;
  const availableDate = value(filters, "availableBefore");
  const page = positiveInteger(value(filters, "page"), 1);
  const pageSize = 9;

  let results: SalonSearchResult[] = [];
  let loadError = false;

  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("search_public_salons", {
      search_text: searchText || null,
      filter_country_code: country || null,
      filter_city: city || null,
      filter_postal_code: postalCode || null,
      filter_category: category || null,
      maximum_price: maximumPrice,
      available_before: availableDate ? `${availableDate}T23:59:59.999Z` : null,
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
    });

    loadError = Boolean(error);
    if (data) results = data as SalonSearchResult[];
  }

  const total = Number(results[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="min-h-screen bg-[#faf9f6] text-slate-950 dark:bg-[#101216] dark:text-stone-100">
      <header className="border-b border-[#e7ddd0] bg-[#faf9f6]/95 dark:border-white/10 dark:bg-[#101216]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href={`/${locale}/salons`} className="flex items-center gap-3" aria-label="GlowFlow">
            <span className="grid size-10 place-items-center rounded-2xl bg-slate-950 text-[#e7b779] dark:bg-[#e7b779] dark:text-slate-950">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <span>
              <strong className="block text-lg tracking-[-0.04em]">GlowFlow</strong>
              <span className="block text-xs text-slate-500 dark:text-stone-400">{labels.marketplace}</span>
            </span>
          </Link>
          <LanguageSwitcher locale={locale} compact />
        </div>
      </header>

      <section className="border-b border-[#e7ddd0] bg-[radial-gradient(circle_at_top_left,#f3dcc2,transparent_42%),linear-gradient(180deg,#fffdf9,#faf9f6)] dark:border-white/10 dark:bg-[radial-gradient(circle_at_top_left,#4b3828,transparent_36%),linear-gradient(180deg,#17191e,#101216)]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a56d37] dark:text-[#efc992]">{labels.eyebrow}</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-[-0.055em] sm:text-5xl">{labels.title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-stone-300">{labels.subtitle}</p>

          <form className="mt-8 rounded-[1.75rem] border border-[#e4d6c5] bg-white p-4 shadow-[0_18px_60px_rgba(48,32,18,0.10)] dark:border-white/10 dark:bg-[#17191e]" method="get">
            <div className="grid gap-3 lg:grid-cols-[1.7fr_1fr_1fr]">
              <label className="text-sm font-medium">
                {labels.search}
                <span className="relative mt-2 block">
                  <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input name="q" defaultValue={searchText} placeholder={labels.searchPlaceholder} className="h-12 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] pl-11 pr-4 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5" />
                </span>
              </label>
              <label className="text-sm font-medium">
                {labels.country}
                <select name="country" defaultValue={country} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-4 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5">
                  <option value="">{labels.allCountries}</option>
                  {fallbackMarkets.map((market) => (
                    <option key={market.country_code} value={market.country_code}>{marketName(market, locale)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                {labels.city}
                <input name="city" defaultValue={city} placeholder={labels.cityPlaceholder} className="mt-2 h-12 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-4 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5" />
              </label>
            </div>

            <details className="mt-3 rounded-xl border border-[#eadfD2] px-4 py-3 dark:border-white/10">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {labels.category}, {labels.postal}, {labels.maximumPrice}
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm font-medium">
                  {labels.postal}
                  <input name="postcode" defaultValue={postalCode} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none dark:border-white/15 dark:bg-white/5" />
                </label>
                <label className="text-sm font-medium">
                  {labels.category}
                  <select name="category" defaultValue={category} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none dark:border-white/15 dark:bg-white/5">
                    <option value="">{labels.allCategories}</option>
                    <option value="hair">{labels.hair}</option>
                    <option value="nails">{labels.nails}</option>
                    <option value="other">{labels.other}</option>
                  </select>
                </label>
                <label className="text-sm font-medium">
                  {labels.maximumPrice}
                  <input name="maxPrice" type="number" min="1" step="1" defaultValue={maxPriceValue} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none dark:border-white/15 dark:bg-white/5" />
                </label>
                <label className="text-sm font-medium">
                  {labels.availableBefore}
                  <input name="availableBefore" type="date" defaultValue={availableDate} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none dark:border-white/15 dark:bg-white/5" />
                </label>
              </div>
            </details>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button className="h-12 rounded-xl bg-slate-950 px-6 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950" type="submit">{labels.submit}</button>
              <Link className="px-4 py-3 text-center text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]" href={`/${locale}/salons`}>{labels.reset}</Link>
            </div>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8" aria-live="polite">
        {loadError ? (
          <div className="rounded-[1.75rem] border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
            <h2 className="text-xl font-semibold">{labels.errorTitle}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.errorText}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-[#d9c7b2] bg-white/60 p-10 text-center dark:border-white/15 dark:bg-white/5">
            <Search className="mx-auto size-8 text-[#b77a42]" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold">{labels.emptyTitle}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.emptyText}</p>
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm font-semibold text-slate-600 dark:text-stone-300">
              {total} {total === 1 ? labels.oneResult : labels.results}
            </p>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {results.map((salon) => (
                <article key={salon.slug} className="overflow-hidden rounded-[1.75rem] border border-[#e4d6c5] bg-white shadow-[0_12px_36px_rgba(48,32,18,0.08)] dark:border-white/10 dark:bg-[#17191e]">
                  <div className="grid h-36 place-items-center bg-[linear-gradient(135deg,#ead7c1,#f5ece2_52%,#dec0a1)] text-3xl font-semibold text-slate-900 dark:bg-[linear-gradient(135deg,#473529,#2b2724)] dark:text-[#efc992]">
                    {salonInitials(salon.business_name)}
                  </div>
                  <div className="p-5">
                    <div className="flex flex-wrap gap-2">
                      {salon.categories.map((item) => (
                        <span key={item} className="rounded-full bg-[#f3e8dc] px-3 py-1 text-xs font-semibold text-[#7b4b24] dark:bg-[#342b23] dark:text-[#efc992]">
                          {item === "hair" ? labels.hair : item === "nails" ? labels.nails : labels.other}
                        </span>
                      ))}
                    </div>
                    <h2 className="mt-4 text-xl font-semibold tracking-[-0.035em]">{salon.business_name}</h2>
                    <p className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-stone-400">
                      <MapPin className="size-4" aria-hidden="true" />
                      {salon.city}, {salon.postal_code} · {salon.country_code}
                    </p>
                    {localizedDescription(salon, locale) ? (
                      <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-stone-300">{localizedDescription(salon, locale)}</p>
                    ) : null}
                    <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#eee4d8] pt-4 text-sm dark:border-white/10">
                      <span>
                        <span className="block text-xs text-slate-500 dark:text-stone-400">{labels.from}</span>
                        <strong>{salon.starting_price === null ? "—" : formatMoney(salon.starting_price, salon.currency, locale)}</strong>
                      </span>
                      <span>
                        <span className="block text-xs text-slate-500 dark:text-stone-400">{labels.next}</span>
                        <strong className="flex items-center gap-1">
                          <CalendarDays className="size-3.5" aria-hidden="true" />
                          {salon.next_available_at
                            ? formatLocalDateTime(salon.next_available_at, locale, fallbackMarkets.find((market) => market.country_code === salon.country_code)?.default_time_zone ?? "UTC")
                            : labels.availabilityUnknown}
                        </strong>
                      </span>
                    </div>
                    <Link href={`/${locale}/book/${salon.slug}`} className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950">
                      {labels.book}
                    </Link>
                  </div>
                </article>
              ))}
            </div>

            {totalPages > 1 ? (
              <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
                {page > 1 ? <Link className="rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold" href={pageHref(locale, filters, page - 1)}>{labels.previous}</Link> : null}
                <span className="text-sm text-slate-600 dark:text-stone-300">{labels.page} {page} / {totalPages}</span>
                {page < totalPages ? <Link className="rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold" href={pageHref(locale, filters, page + 1)}>{labels.nextPage}</Link> : null}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
