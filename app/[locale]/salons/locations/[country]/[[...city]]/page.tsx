import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { MarketplaceSalonCard } from "@/components/glowflow/marketplace-salon-card";
import { isLocale, salonProfileLocale, type Locale } from "@/lib/i18n";
import { marketplaceLocation, marketplaceLocationHref } from "@/lib/marketplace-locations";
import { marketName } from "@/lib/markets";
import type { SalonSearchResult } from "@/lib/salon-search";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Params = { locale: string; country: string; city?: string[] };
type SearchParams = { page?: string | string[] };

const pageSize = 9;
const copy = {
  fr: { marketplace: "Tous les salons", country: "Salons par pays", city: "Salons par ville", title: "Salons de beauté", intro: "Découvrez les salons publiés et choisissez votre prochain rendez-vous.", results: "salons trouvés", oneResult: "salon trouvé", browse: "Affiner la recherche", empty: "Aucun salon publié ici pour le moment.", unavailable: "La recherche est momentanément indisponible.", previous: "Précédent", nextPage: "Suivant", page: "Page", hair: "Coiffure", nails: "Ongles", other: "Autres", from: "À partir de", price: "Prix", priceUnavailable: "Tarif indisponible", next: "Prochain créneau", availabilityUnknown: "Disponibilité sur la page du salon", book: "Voir et réserver" },
  en: { marketplace: "All salons", country: "Salons by country", city: "Salons by city", title: "Beauty salons", intro: "Explore published salons and choose your next appointment.", results: "salons found", oneResult: "salon found", browse: "Refine your search", empty: "No salons are published here yet.", unavailable: "Search is temporarily unavailable.", previous: "Previous", nextPage: "Next", page: "Page", hair: "Hair", nails: "Nails", other: "Other", from: "From", price: "Price", priceUnavailable: "Price unavailable", next: "Next opening", availabilityUnknown: "Availability on the salon page", book: "View and book" },
  es: { marketplace: "Todos los salones", country: "Salones por país", city: "Salones por ciudad", title: "Salones de belleza", intro: "Descubre los salones publicados y elige tu próxima cita.", results: "salones encontrados", oneResult: "salón encontrado", browse: "Afinar la búsqueda", empty: "Todavía no hay salones publicados aquí.", unavailable: "La búsqueda no está disponible temporalmente.", previous: "Anterior", nextPage: "Siguiente", page: "Página", hair: "Cabello", nails: "Uñas", other: "Otros", from: "Desde", price: "Precio", priceUnavailable: "Precio no disponible", next: "Próxima disponibilidad", availabilityUnknown: "Disponibilidad en la página del salón", book: "Ver y reservar" },
} as const;

function locationTitle(locale: Locale, countryName: string, city?: string) {
  return `${copy[locale].title}: ${city ? `${city}, ` : ""}${countryName}`;
}

function pageNumber(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 1000 ? parsed : 1;
}

export async function generateMetadata({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const { locale, country, city: citySegments } = await params;
  if (!isLocale(locale)) return {};
  const location = marketplaceLocation(country, citySegments);
  if (!location) return { robots: { index: false, follow: false } };
  const page = pageNumber((await searchParams).page);
  const countryName = marketName(location.market, locale);
  const title = locationTitle(locale, countryName, location.city);
  const pageSuffix = page > 1 ? `?page=${page}` : "";
  const pathname = marketplaceLocationHref(locale, country, location.city);
  return {
    title,
    description: `${title}. ${copy[locale].intro}`,
    alternates: {
      canonical: pathname + pageSuffix,
      languages: {
        fr: marketplaceLocationHref("fr", country, location.city) + pageSuffix,
        en: marketplaceLocationHref("en", country, location.city) + pageSuffix,
        es: marketplaceLocationHref("es", country, location.city) + pageSuffix,
      },
    },
    openGraph: { title, description: copy[locale].intro, type: "website", url: `https://glowflow.mocktar.com${pathname}${pageSuffix}` },
  };
}

export default async function LocationPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<SearchParams> }) {
  const { locale, country, city: citySegments } = await params;
  if (!isLocale(locale)) notFound();
  const location = marketplaceLocation(country, citySegments);
  if (!location) notFound();
  const page = pageNumber((await searchParams).page);
  const labels = copy[locale];
  const countryName = marketName(location.market, locale);
  const title = locationTitle(locale, countryName, location.city);
  const pathname = marketplaceLocationHref(locale, country, location.city);
  const searchQuery = new URLSearchParams({ country, ...(location.city ? { city: location.city } : {}) });
  const visitorPreference = (await cookies()).get("glowflow_locale")?.value;
  let results: SalonSearchResult[] = [];
  let loadError = false;
  let countryDefaultLocale: string = location.market.default_locale;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("search_public_salons", {
      search_text: null,
      filter_country_code: country,
      filter_city: location.city ?? null,
      filter_postal_code: null,
      filter_category: null,
      maximum_price: null,
      available_before: null,
      page_size: pageSize,
      page_offset: (page - 1) * pageSize,
    });
    loadError = Boolean(error);
    if (data) results = data as SalonSearchResult[];
    if (results.length && !isLocale(visitorPreference ?? "")) {
      const { data: market } = await supabase
        .from("markets")
        .select("default_locale")
        .eq("country_code", country)
        .maybeSingle();
      if (market?.default_locale) countryDefaultLocale = market.default_locale;
    }
  } else {
    loadError = true;
  }

  const total = Number(results[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const jsonLd = !loadError && results.length ? JSON.stringify({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: title,
    url: `https://glowflow.mocktar.com${pathname}${page > 1 ? `?page=${page}` : ""}`,
    about: { "@type": "Place", name: location.city ?? countryName, address: { "@type": "PostalAddress", ...(location.city ? { addressLocality: location.city } : {}), addressCountry: country } },
    mainEntity: { "@type": "ItemList", itemListElement: results.map((salon, index) => ({ "@type": "ListItem", position: (page - 1) * pageSize + index + 1, name: salon.business_name, url: `https://glowflow.mocktar.com/${locale}/salons/${salon.slug}` })) },
  }).replace(/</g, "\\u003c") : null;

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6">
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} /> : null}
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <Link href={`/${locale}/salons`} className="text-lg font-semibold tracking-tight">GlowFlow</Link>
          <LanguageSwitcher locale={locale} />
        </header>
        <nav aria-label={location.city ? labels.city : labels.country} className="mt-8 flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/${locale}/salons`} className="underline underline-offset-4">{labels.marketplace}</Link>
          <span aria-hidden="true">/</span>
          {location.city ? <><Link href={marketplaceLocationHref(locale, country)} className="underline underline-offset-4">{countryName}</Link><span aria-hidden="true">/</span><span aria-current="page">{location.city}</span></> : <span aria-current="page">{countryName}</span>}
        </nav>
        <section className="mt-8 rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e] sm:p-10">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#a56d37] dark:text-[#efc992]">{location.city ? labels.city : labels.country}</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-5xl">{title}</h1>
          <p className="mt-4 text-slate-600 dark:text-stone-300">{labels.intro}</p>
          <Link href={`/${locale}/salons?${searchQuery.toString()}`} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:bg-[#e7b779] dark:text-slate-950">{labels.browse}</Link>
        </section>
        <section className="mt-9" aria-live="polite">
          {loadError ? <p role="status" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900/50 dark:bg-rose-950/20">{labels.unavailable}</p> : results.length === 0 ? <p className="rounded-2xl border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]">{labels.empty}</p> : <>
            <p className="mb-5 text-sm font-semibold text-slate-600 dark:text-stone-300">{total} {total === 1 ? labels.oneResult : labels.results}</p>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {results.map((salon) => <MarketplaceSalonCard
                key={salon.slug}
                salon={salon}
                locale={locale}
                href={`/${salonProfileLocale(countryDefaultLocale, visitorPreference, locale)}/salons/${salon.slug}`}
                cityHref={!location.city && marketplaceLocation(country, [salon.city]) ? marketplaceLocationHref(locale, country, salon.city) : undefined}
                labels={labels}
              />)}
            </div>
            {totalPages > 1 ? <nav className="mt-8 flex items-center justify-center gap-4" aria-label={labels.page}>
              {page > 1 ? <Link href={`${pathname}${page > 2 ? `?page=${page - 1}` : ""}`} className="rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold">{labels.previous}</Link> : null}
              <span className="text-sm">{labels.page} {page} / {totalPages}</span>
              {page < totalPages ? <Link href={`${pathname}?page=${page + 1}`} className="rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold">{labels.nextPage}</Link> : null}
            </nav> : null}
          </>}
        </section>
      </div>
    </main>
  );
}
