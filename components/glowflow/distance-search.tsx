"use client";

import { useRef, useState, type ReactNode } from "react";

import { MarketplaceSalonCard } from "@/components/glowflow/marketplace-salon-card";
import { salonProfileLocale, type Locale } from "@/lib/i18n";
import { fallbackMarkets } from "@/lib/markets";
import { marketplaceLocation, marketplaceLocationHref } from "@/lib/marketplace-locations";
import { coarseVisitorOrigin, type SalonSearchResult } from "@/lib/salon-search";
import { publicSalonTimeZones } from "@/lib/salon-time-zones";

type SearchFilters = {
  search_text: string | null;
  filter_country_code: string | null;
  filter_city: string | null;
  filter_postal_code: string | null;
  filter_category: string | null;
  maximum_price: number | null;
  available_before: string | null;
};

type CardLabels = {
  hair: string; nails: string; other: string; from: string; price: string;
  priceUnavailable: string; next: string; availabilityUnknown: string; book: string;
};

const copy = {
  fr: { action: "Trier près de moi", clear: "Arrêter le tri par distance", requesting: "Recherche de votre position…", loading: "Tri par distance…", denied: "Position indisponible. Choisissez un pays ou une ville pour rechercher manuellement.", unavailable: "Le tri par distance est indisponible. Les résultats actuels restent affichés.", noPins: "Aucun salon correspondant n’a de point sur la carte. Les résultats actuels restent affichés. Vous pouvez rechercher par pays ou ville.", active: "Salons triés par distance approximative. Ceux sans point sur la carte apparaissent à la fin.", results: "salons trouvés", oneResult: "salon trouvé", previous: "Précédent", next: "Suivant", page: "Page", of: "sur", empty: "Aucun salon ne correspond à ces critères." },
  en: { action: "Sort near me", clear: "Stop distance sorting", requesting: "Finding your location…", loading: "Sorting by distance…", denied: "Location unavailable. Choose a country or city to search manually.", unavailable: "Distance sorting is unavailable. Current results remain visible.", noPins: "No matching salon has a map point. Current results remain visible. You can search by country or city.", active: "Salons sorted by approximate distance. Those without a map point appear last.", results: "salons found", oneResult: "salon found", previous: "Previous", next: "Next", page: "Page", of: "of", empty: "No salons match these filters." },
  es: { action: "Ordenar cerca de mí", clear: "Dejar de ordenar por distancia", requesting: "Buscando tu ubicación…", loading: "Ordenando por distancia…", denied: "Ubicación no disponible. Elige un país o una ciudad para buscar manualmente.", unavailable: "La ordenación por distancia no está disponible. Se mantienen los resultados actuales.", noPins: "Ningún salón coincidente tiene un punto en el mapa. Se mantienen los resultados actuales. Puedes buscar por país o ciudad.", active: "Salones ordenados por distancia aproximada. Los que no tienen punto en el mapa aparecen al final.", results: "salones encontrados", oneResult: "salón encontrado", previous: "Anterior", next: "Siguiente", page: "Página", of: "de", empty: "Ningún salón coincide con estos filtros." },
} as const;

export function DistanceSearch({ children, locale, labels, filters, pageSize, visitorPreference, countryDefaultLocales, initialSalonTimeZones, enabled }: {
  children: ReactNode;
  locale: Locale;
  labels: CardLabels;
  filters: SearchFilters;
  pageSize: number;
  visitorPreference: string | null;
  countryDefaultLocales: Record<string, string>;
  initialSalonTimeZones: Record<string, string>;
  enabled: boolean;
}) {
  const messages = copy[locale];
  const [origin, setOrigin] = useState<ReturnType<typeof coarseVisitorOrigin>>(null);
  const [distanceResults, setDistanceResults] = useState<SalonSearchResult[] | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [salonTimeZones, setSalonTimeZones] = useState(initialSalonTimeZones);
  const [status, setStatus] = useState<"idle" | "requesting" | "loading" | "denied" | "unavailable" | "noPins" | "active">("idle");
  const requestId = useRef(0);

  async function searchNearby(point: NonNullable<typeof origin>, requestedPage: number) {
    const currentRequest = ++requestId.current;
    setStatus("loading");
    try {
      const { createClient } = await import("@/lib/supabase/client");
      if (currentRequest !== requestId.current) return;
      const supabase = createClient();
      const { data, error } = await supabase.rpc("search_public_salons_by_distance", {
        ...point,
        ...filters,
        page_size: pageSize,
        page_offset: (requestedPage - 1) * pageSize,
      });
      if (currentRequest !== requestId.current) return;
      if (error || !Array.isArray(data)) {
        setStatus("unavailable");
        return;
      }
      const salons = data as SalonSearchResult[];
      // Pinned rows sort first. A first page with no pinned row cannot be called distance-sorted.
      if (requestedPage === 1 && !salons.some((salon) => salon.distance_meters !== null && salon.distance_meters !== undefined)) {
        setDistanceResults(null);
        setStatus("noPins");
        return;
      }
      const zones = await publicSalonTimeZones(salons);
      if (currentRequest !== requestId.current) return;
      setSalonTimeZones((current) => ({ ...current, ...zones }));
      setDistanceResults(salons);
      setPage(requestedPage);
      setTotal(Number(salons[0]?.total_count ?? total));
      setStatus("active");
    } catch {
      if (currentRequest === requestId.current) setStatus("unavailable");
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      setStatus("denied");
      return;
    }
    const currentRequest = ++requestId.current;
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (currentRequest !== requestId.current) return;
        const point = coarseVisitorOrigin(coords.latitude, coords.longitude);
        if (!point) {
          setStatus("denied");
          return;
        }
        setOrigin(point);
        void searchNearby(point, 1);
      },
      () => {
        if (currentRequest === requestId.current) setStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }

  function clearDistance() {
    requestId.current++;
    setOrigin(null);
    setDistanceResults(null);
    setStatus("idle");
  }

  const busy = status === "requesting" || status === "loading";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const announcement = status === "active" && distanceResults
    ? `${total} ${total === 1 ? messages.oneResult : messages.results}.${totalPages > 1 ? ` ${messages.page} ${page} ${messages.of} ${totalPages}.` : ""}`
    : status === "idle" ? "" : messages[status];

  return (
    <>
      {enabled ? <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={requestLocation} disabled={busy} className="min-h-11 rounded-xl border border-[#cdbba6] bg-white px-4 py-2 text-sm font-semibold text-[#7b4b24] hover:bg-[#faf5ed] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] disabled:opacity-60 dark:border-white/20 dark:bg-white/5 dark:text-[#efc992] dark:hover:bg-white/10 dark:focus-visible:outline-[#efc992]">{messages.action}</button>
        {distanceResults || busy ? <button type="button" onClick={clearDistance} className="min-h-11 rounded-xl px-3 py-2 text-sm font-semibold text-[#9a602d] hover:underline focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] dark:text-[#efc992] dark:focus-visible:outline-[#efc992]">{messages.clear}</button> : null}
        {status !== "idle" ? <p className="text-sm text-slate-600 dark:text-stone-300">{messages[status]}</p> : null}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</p>
      </div> : null}
      {distanceResults ? <>
        <p className="mb-5 text-sm font-semibold text-slate-600 dark:text-stone-300">{total} {total === 1 ? messages.oneResult : messages.results}</p>
        {distanceResults.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {distanceResults.map((salon) => <MarketplaceSalonCard
            key={salon.slug}
            salon={salon}
            locale={locale}
            href={`/${salonProfileLocale(countryDefaultLocales[salon.country_code] ?? fallbackMarkets.find((market) => market.country_code === salon.country_code)?.default_locale, visitorPreference, locale)}/salons/${salon.slug}`}
            cityHref={marketplaceLocation(salon.country_code, [salon.city]) ? marketplaceLocationHref(locale, salon.country_code, salon.city) : undefined}
            timeZone={salonTimeZones[salon.slug]}
            labels={labels}
          />)}
        </div> : <p className="text-sm text-slate-600 dark:text-stone-300">{messages.empty}</p>}
        {totalPages > 1 ? <nav className="mt-8 flex items-center justify-center gap-3" aria-label={`${messages.page} ${page}`}>
          {page > 1 ? <button type="button" disabled={busy} onClick={() => origin && void searchNearby(origin, page - 1)} className="min-h-11 rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] disabled:opacity-60 dark:focus-visible:outline-[#efc992]">{messages.previous}</button> : null}
          <span className="text-sm text-slate-600 dark:text-stone-300">{messages.page} {page} / {totalPages}</span>
          {page < totalPages ? <button type="button" disabled={busy} onClick={() => origin && void searchNearby(origin, page + 1)} className="min-h-11 rounded-xl border border-[#d9c7b2] px-4 py-2 text-sm font-semibold focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8a5728] disabled:opacity-60 dark:focus-visible:outline-[#efc992]">{messages.next}</button> : null}
        </nav> : null}
      </> : children}
    </>
  );
}
