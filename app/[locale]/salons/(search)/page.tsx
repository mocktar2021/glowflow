import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeft, Search, SlidersHorizontal } from "lucide-react";
import { notFound } from "next/navigation";

import { BrandLogo } from "@/components/glowflow/brand-logo";
import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { DistanceSearch } from "@/components/glowflow/distance-search";
import { MarketplaceSalonCard } from "@/components/glowflow/marketplace-salon-card";
import { VisitorTimeZoneField } from "@/components/glowflow/visitor-time-zone-field";
import { isLocale, salonProfileLocale, type Locale } from "@/lib/i18n";
import { endOfLocalDayUtc, isValidIanaTimeZone, timeZoneOptions } from "@/lib/marketplace-time-zones";
import { fallbackMarkets, marketName } from "@/lib/markets";
import { marketplaceLocation, marketplaceLocationHref } from "@/lib/marketplace-locations";
import { publicSalonTimeZones } from "@/lib/salon-time-zones";
import {
  isSalonCategory,
  maximumPriceMinorUnits,
  salonSearchPage,
  salonSearchSort,
  type SalonSearchResult,
} from "@/lib/salon-search";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const copy = {
  fr: {
    home: "Accueil",
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
    availableBefore: "Disponible d’ici la fin du",
    timeZone: "Fuseau horaire du filtre",
    timeZoneHelp: "La date utilise ce fuseau horaire. Les horaires affichés sur les cartes utilisent celui de chaque salon.",
    invalidTimeZone: "Ce fuseau horaire n’est pas reconnu. Le filtre utilise UTC.",
    invalidDate: "Cette date n’est pas valide. Le filtre de disponibilité n’a pas été appliqué.",
    submit: "Rechercher",
    reset: "Effacer les filtres",
    results: "salons trouvés",
    oneResult: "salon trouvé",
    from: "À partir de",
    price: "Prix",
    priceUnavailable: "Tarif indisponible",
    next: "Prochain créneau",
    availabilityUnknown: "Disponibilité sur la page du salon",
    book: "Voir et réserver",
    emptyTitle: "Aucun salon ne correspond à ces critères",
    emptyText: "Modifiez votre ville, votre catégorie ou votre prix maximum.",
    errorTitle: "La recherche est indisponible",
    errorText: "Réessayez dans quelques instants.",
    ownerLogin: "Espace salon",
    filteredEmptyTitle: "Aucun salon ne correspond à ces critères",
    filteredEmptyText: "Modifiez ou effacez les filtres pour élargir votre recherche.",
    browseEmptyTitle: "Les premiers salons arrivent bientôt",
    browseEmptyText: "Les salons apparaîtront ici uniquement après que leur propriétaire aura choisi de publier leur profil.",
    previous: "Précédent",
    nextPage: "Suivant",
    page: "Page",
    marketplace: "Marketplace beauté",
    exploreCountries: "Explorer les salons par pays",
    sort: "Trier par",
    sortRelevance: "Pertinence",
    sortPriceAsc: "Prix croissant",
    sortPriceDesc: "Prix décroissant",
    sortAvailability: "Prochain créneau",
    sortUnavailable: "Le tri est momentanément indisponible. Les résultats sont affichés par pertinence.",
    priceSortNeedsCountry: "Choisissez un pays pour comparer les prix dans une même devise. Les résultats sont affichés par pertinence.",
    invalidCountry: "Ce pays n’est pas disponible dans la recherche. Tous les pays disponibles sont affichés.",
  },
  en: {
    home: "Home",
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
    availableBefore: "Available by end of date",
    timeZone: "Filter time zone",
    timeZoneHelp: "The date uses this time zone. Times on salon cards use each salon’s own time zone.",
    invalidTimeZone: "That time zone is not recognized. The filter uses UTC.",
    invalidDate: "That date is invalid. The availability filter was not applied.",
    submit: "Search",
    reset: "Clear filters",
    results: "salons found",
    oneResult: "salon found",
    from: "From",
    price: "Price",
    priceUnavailable: "Price unavailable",
    next: "Next opening",
    availabilityUnknown: "Availability on the salon page",
    book: "View and book",
    emptyTitle: "No salons match these filters",
    emptyText: "Change your city, category, or maximum price.",
    errorTitle: "Search is unavailable",
    errorText: "Please try again in a moment.",
    ownerLogin: "Salon sign in",
    filteredEmptyTitle: "No salons match these filters",
    filteredEmptyText: "Change or clear the filters to broaden your search.",
    browseEmptyTitle: "The first salons are coming soon",
    browseEmptyText: "Salons will appear here only after their owner chooses to publish their profile.",
    previous: "Previous",
    nextPage: "Next",
    page: "Page",
    marketplace: "Beauty marketplace",
    exploreCountries: "Explore salons by country",
    sort: "Sort by",
    sortRelevance: "Relevance",
    sortPriceAsc: "Price: low to high",
    sortPriceDesc: "Price: high to low",
    sortAvailability: "Soonest available",
    sortUnavailable: "Sorting is temporarily unavailable. Results are shown by relevance.",
    priceSortNeedsCountry: "Choose a country to compare prices in one currency. Results are shown by relevance.",
    invalidCountry: "That country is not available in search. Showing all available countries.",
  },
  es: {
    home: "Inicio",
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
    availableBefore: "Disponible antes de terminar el día",
    timeZone: "Zona horaria del filtro",
    timeZoneHelp: "La fecha usa esta zona horaria. Las horas en las tarjetas usan la zona de cada salón.",
    invalidTimeZone: "No se reconoce esa zona horaria. El filtro usa UTC.",
    invalidDate: "La fecha no es válida. No se aplicó el filtro de disponibilidad.",
    submit: "Buscar",
    reset: "Borrar filtros",
    results: "salones encontrados",
    oneResult: "salón encontrado",
    from: "Desde",
    price: "Precio",
    priceUnavailable: "Precio no disponible",
    next: "Próxima disponibilidad",
    availabilityUnknown: "Disponibilidad en la página del salón",
    book: "Ver y reservar",
    emptyTitle: "Ningún salón coincide con estos filtros",
    emptyText: "Cambia la ciudad, la categoría o el precio máximo.",
    errorTitle: "La búsqueda no está disponible",
    errorText: "Inténtalo de nuevo en unos instantes.",
    ownerLogin: "Acceso para salones",
    filteredEmptyTitle: "Ningún salón coincide con estos filtros",
    filteredEmptyText: "Cambia o borra los filtros para ampliar la búsqueda.",
    browseEmptyTitle: "Los primeros salones llegarán pronto",
    browseEmptyText: "Los salones aparecerán aquí solo cuando su propietario decida publicar el perfil.",
    previous: "Anterior",
    nextPage: "Siguiente",
    page: "Página",
    marketplace: "Marketplace de belleza",
    exploreCountries: "Explorar salones por país",
    sort: "Ordenar por",
    sortRelevance: "Relevancia",
    sortPriceAsc: "Precio: de menor a mayor",
    sortPriceDesc: "Precio: de mayor a menor",
    sortAvailability: "Próxima disponibilidad",
    sortUnavailable: "La ordenación no está disponible temporalmente. Los resultados se muestran por relevancia.",
    priceSortNeedsCountry: "Elige un país para comparar precios en una sola moneda. Los resultados se muestran por relevancia.",
    invalidCountry: "Ese país no está disponible en la búsqueda. Se muestran todos los países disponibles.",
  },
} as const;

type SearchParams = Record<string, string | string[] | undefined>;

const extraCopy = {
  fr: { priceNeedsCountry: "Choisissez un pays pour filtrer le prix dans sa devise. Le filtre de prix n’a pas été appliqué.", pageAdjusted: "Cette page n’existe pas. Les premiers résultats sont affichés." },
  en: { priceNeedsCountry: "Choose a country to filter prices in its currency. The price filter was not applied.", pageAdjusted: "That page does not exist. Showing the first results." },
  es: { priceNeedsCountry: "Elige un país para filtrar precios en su moneda. No se aplicó el filtro de precio.", pageAdjusted: "Esa página no existe. Se muestran los primeros resultados." },
} as const;

const allowedQueryKeys = new Set(["q", "country", "city", "postcode", "category", "maxPrice", "availableBefore", "timeZone", "sort"]);

function value(params: SearchParams, key: string) {
  const item = params[key];
  return Array.isArray(item) ? item[0] ?? "" : item ?? "";
}

function pageHref(locale: Locale, params: SearchParams, page: number) {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (item && allowedQueryKeys.has(key)) query.set(key, item);
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
  const requestedCountry = value(filters, "country").trim().toUpperCase();
  const selectedMarket = fallbackMarkets.find((market) => market.country_code === requestedCountry);
  const country = selectedMarket?.country_code ?? "";
  const invalidCountry = Boolean(requestedCountry && !selectedMarket);
  const city = value(filters, "city").trim();
  const postalCode = value(filters, "postcode").trim();
  const categoryValue = value(filters, "category");
  const category = isSalonCategory(categoryValue) ? categoryValue : "";
  const sortBy = salonSearchSort(value(filters, "sort"));
  const priceSortNeedsCountry = (sortBy === "price_asc" || sortBy === "price_desc") && !selectedMarket;
  const effectiveSort = priceSortNeedsCountry ? "relevance" : sortBy;
  const maxPriceValue = value(filters, "maxPrice");
  const maxPriceNeedsCountry = Boolean(maxPriceValue && !selectedMarket);
  const maximumPrice = maximumPriceMinorUnits(maxPriceValue, selectedMarket?.currency ?? null);
  const availableDate = value(filters, "availableBefore");
  const hasAdvancedFilters = Boolean(postalCode || category || maxPriceValue || availableDate);
  const requestedTimeZone = value(filters, "timeZone");
  const invalidTimeZone = Boolean(requestedTimeZone && !isValidIanaTimeZone(requestedTimeZone));
  // Legacy date-only links keep their original UTC meaning. For a new search,
  // the client field detects the browser zone after hydration and submits it.
  const selectedTimeZone = requestedTimeZone && !invalidTimeZone ? requestedTimeZone : "UTC";
  const availableBefore = availableDate ? endOfLocalDayUtc(availableDate, selectedTimeZone) : null;
  const invalidDate = Boolean(availableDate && !availableBefore);
  const paginationFilters = { ...filters, country, ...(invalidTimeZone ? { timeZone: selectedTimeZone } : {}) };
  const requestedPage = value(filters, "page");
  let page = salonSearchPage(requestedPage);
  let pageAdjusted = Boolean(requestedPage && page === 1 && requestedPage !== "1");
  const pageSize = 9;

  let results: SalonSearchResult[] = [];
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  let loadError = !configured;
  let sortUnavailable = false;
  let countryDefaultLocales = new Map<string, string>();
  let salonTimeZones: Record<string, string> = {};
  const visitorPreference = (await cookies()).get("glowflow_locale")?.value;
  const rpcFilters = {
    search_text: searchText || null,
    filter_country_code: country || null,
    filter_city: city || null,
    filter_postal_code: postalCode || null,
    filter_category: category || null,
    maximum_price: maximumPrice,
    available_before: availableBefore,
  };

  if (configured) {
    const supabase = await createClient();
    async function searchAt(offset: number, useLegacyRpc: boolean) {
      const rpcArgs = { ...rpcFilters, page_size: pageSize, page_offset: offset };
      let { data, error } = await supabase.rpc(
        effectiveSort === "relevance" || useLegacyRpc ? "search_public_salons" : "search_public_salons_sorted",
        effectiveSort === "relevance" || useLegacyRpc ? rpcArgs : { ...rpcArgs, sort_by: effectiveSort },
      );
      if (effectiveSort !== "relevance" && error?.code === "PGRST202") {
        ({ data, error } = await supabase.rpc("search_public_salons", rpcArgs));
        return { data, error, fallback: true };
      }
      return { data, error, fallback: false };
    }

    let response = await searchAt((page - 1) * pageSize, false);
    sortUnavailable = response.fallback;
    let { data, error } = response;
    if (!error && (!data || data.length === 0) && page > 1) {
      response = await searchAt(0, sortUnavailable);
      sortUnavailable ||= response.fallback;
      ({ data, error } = response);
      page = 1;
      pageAdjusted = true;
    }

    loadError = Boolean(error);
    if (data) results = data as SalonSearchResult[];
    const timeZonePromise = publicSalonTimeZones(results);
    if (results.length && !isLocale(visitorPreference ?? "")) {
      const countryCodes = [...new Set(results.map((salon) => salon.country_code))];
      const { data: markets } = await supabase
        .from("markets")
        .select("country_code, default_locale")
        .in("country_code", countryCodes);
      countryDefaultLocales = new Map((markets ?? []).map((market) => [market.country_code, market.default_locale]));
    }
    salonTimeZones = await timeZonePromise;
  }

  const total = Number(results[0]?.total_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(searchText || country || city || postalCode || category || maxPriceValue || availableDate);

  return (
    <main className="min-h-screen bg-[#faf9f6] text-slate-950 dark:bg-[#101216] dark:text-stone-100">
      <header className="border-b border-[#e7ddd0] bg-[#faf9f6]/95 dark:border-white/10 dark:bg-[#101216]/95">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link href={`/${locale}`} className="flex min-h-11 items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:focus-visible:outline-[#efc992]" aria-label={`GlowFlow, ${labels.home}`}>
            <span>
              <BrandLogo className="h-8 w-28 text-foreground" />
              <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-stone-400"><ArrowLeft className="size-3" aria-hidden="true" />{labels.home}</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2" aria-label={labels.marketplace}>
            <Link href={`/${locale}/login`} className="inline-flex min-h-10 items-center rounded-full px-3 text-sm font-semibold text-[#8c5728] hover:bg-[#f3e8dc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b77a42] dark:text-[#efc992] dark:hover:bg-white/10">{labels.ownerLogin}</Link>
            <LanguageSwitcher locale={locale} />
          </nav>
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

            <details open={hasAdvancedFilters} className="mt-3 rounded-xl border border-[#eadfD2] px-4 py-3 dark:border-white/10">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md text-sm font-semibold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:focus-visible:outline-[#efc992]">
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {labels.category}, {labels.postal}, {labels.maximumPrice}, {labels.availableBefore}
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <label className="text-sm font-medium">
                  {labels.postal}
                  <input name="postcode" defaultValue={postalCode} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:border-white/15 dark:bg-white/5" />
                </label>
                <label className="text-sm font-medium">
                  {labels.category}
                  <select name="category" defaultValue={category} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:border-white/15 dark:bg-white/5">
                    <option value="">{labels.allCategories}</option>
                    <option value="hair">{labels.hair}</option>
                    <option value="nails">{labels.nails}</option>
                    <option value="other">{labels.other}</option>
                  </select>
                </label>
                <label className="text-sm font-medium">
                  {labels.maximumPrice}{selectedMarket ? ` (${selectedMarket.currency})` : ""}
                  <input name="maxPrice" type="number" min="0.01" step="0.01" defaultValue={maxPriceValue} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:border-white/15 dark:bg-white/5" />
                </label>
                <label className="text-sm font-medium">
                  {labels.availableBefore}
                  <input name="availableBefore" type="date" defaultValue={availableDate} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:border-white/15 dark:bg-white/5" />
                </label>
                <VisitorTimeZoneField
                  initialZone={selectedTimeZone}
                  detectBrowserZone={!requestedTimeZone && !availableDate}
                  options={timeZoneOptions(selectedTimeZone)}
                  label={labels.timeZone}
                  help={labels.timeZoneHelp}
                />
              </div>
            </details>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="text-sm font-medium">
                {labels.sort}
                <select name="sort" defaultValue={sortBy} className="mt-2 h-12 min-w-48 rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-4 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5">
                  <option value="relevance">{labels.sortRelevance}</option>
                  <option value="price_asc">{labels.sortPriceAsc}</option>
                  <option value="price_desc">{labels.sortPriceDesc}</option>
                  <option value="availability">{labels.sortAvailability}</option>
                </select>
              </label>
              <button className="h-12 rounded-xl bg-slate-950 px-6 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:bg-[#e7b779] dark:text-slate-950 dark:focus-visible:outline-[#efc992]" type="submit">{labels.submit}</button>
              <Link className="rounded-xl px-4 py-3 text-center text-sm font-semibold text-[#9a602d] hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:text-[#efc992] dark:focus-visible:outline-[#efc992]" href={`/${locale}/salons`}>{labels.reset}</Link>
            </div>
          </form>
          <nav className="mt-6" aria-label={labels.exploreCountries}>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-stone-200">{labels.exploreCountries}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {fallbackMarkets.map((market) => (
                <Link key={market.country_code} href={marketplaceLocationHref(locale, market.country_code)} className="inline-flex min-h-11 items-center rounded-full border border-[#decaa6] bg-white/80 px-4 py-2 text-sm font-semibold text-[#7b4b24] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:border-white/15 dark:bg-white/5 dark:text-[#efc992]">
                  {marketName(market, locale)}
                </Link>
              ))}
            </div>
          </nav>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {invalidCountry ? <p role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">{labels.invalidCountry}</p> : null}
        {priceSortNeedsCountry ? <p role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">{labels.priceSortNeedsCountry}</p> : null}
        {maxPriceNeedsCountry ? <p role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">{extraCopy[locale].priceNeedsCountry}</p> : null}
        {invalidTimeZone ? <p role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">{labels.invalidTimeZone}</p> : null}
        {invalidDate ? <p role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">{labels.invalidDate}</p> : null}
        {pageAdjusted ? <p role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">{extraCopy[locale].pageAdjusted}</p> : null}
        {sortUnavailable ? <p role="status" className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">{labels.sortUnavailable}</p> : null}
        {/* A new URL must not retain nearby cards fetched for the previous filters. */}
        <DistanceSearch key={pageHref(locale, paginationFilters, page)} locale={locale} labels={labels} filters={rpcFilters} pageSize={pageSize} visitorPreference={visitorPreference ?? null} countryDefaultLocales={Object.fromEntries(countryDefaultLocales)} initialSalonTimeZones={salonTimeZones} enabled={!loadError}
          fallbackAnnouncement={results.length === 0
            ? `${hasFilters ? labels.filteredEmptyTitle : labels.browseEmptyTitle}. ${hasFilters ? labels.filteredEmptyText : labels.browseEmptyText}`
            : `${total} ${total === 1 ? labels.oneResult : labels.results}.`}>
        {loadError ? (
          <div role="status" className="rounded-[1.75rem] border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
            <h2 className="text-xl font-semibold">{labels.errorTitle}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-stone-300">{labels.errorText}</p>
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-[1.75rem] border border-dashed border-[#d9c7b2] bg-white/60 p-10 text-center dark:border-white/15 dark:bg-white/5">
            <Search className="mx-auto size-8 text-[#b77a42]" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold">{hasFilters ? labels.filteredEmptyTitle : labels.browseEmptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-stone-300">{hasFilters ? labels.filteredEmptyText : labels.browseEmptyText}</p>
            {hasFilters ? <Link className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold hover:bg-[#f3e8dc] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:border-white/15 dark:hover:bg-white/10 dark:focus-visible:outline-[#efc992]" href={`/${locale}/salons`}>{labels.reset}</Link> : null}
          </div>
        ) : (
          <>
            <p className="mb-5 text-sm font-semibold text-slate-600 dark:text-stone-300">
              {total} {total === 1 ? labels.oneResult : labels.results}
            </p>
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {results.map((salon) => <MarketplaceSalonCard
                key={salon.slug}
                salon={salon}
                locale={locale}
                countryDefaultLocale={countryDefaultLocales.get(salon.country_code) ?? fallbackMarkets.find((market) => market.country_code === salon.country_code)?.default_locale}
                href={`/${salonProfileLocale(countryDefaultLocales.get(salon.country_code) ?? fallbackMarkets.find((market) => market.country_code === salon.country_code)?.default_locale, visitorPreference, locale)}/salons/${salon.slug}`}
                cityHref={marketplaceLocation(salon.country_code, [salon.city]) ? marketplaceLocationHref(locale, salon.country_code, salon.city) : undefined}
                timeZone={salonTimeZones[salon.slug]}
                labels={labels}
              />)}
            </div>

            {totalPages > 1 ? (
              <nav className="mt-8 flex items-center justify-center gap-3" aria-label={`${labels.page} ${page}`}>
                {page > 1 ? <Link className="inline-flex min-h-11 items-center rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:focus-visible:outline-[#efc992]" href={pageHref(locale, paginationFilters, page - 1)}>{labels.previous}</Link> : null}
                <span className="text-sm text-slate-600 dark:text-stone-300">{labels.page} {page} / {totalPages}</span>
                {page < totalPages ? <Link className="inline-flex min-h-11 items-center rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:focus-visible:outline-[#efc992]" href={pageHref(locale, paginationFilters, page + 1)}>{labels.nextPage}</Link> : null}
              </nav>
            ) : null}
          </>
        )}
        </DistanceSearch>
      </section>
    </main>
  );
}
