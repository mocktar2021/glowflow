import { CalendarDays, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type { Locale } from "@/lib/i18n";
import { fallbackMarkets, formatLocalDateTime, formatMinorMoney } from "@/lib/markets";
import { localizedDescription, publicSalonImageUrl, salonInitials, type SalonSearchResult } from "@/lib/salon-search";

type CardLabels = {
  hair: string;
  nails: string;
  other: string;
  from: string;
  price: string;
  priceUnavailable: string;
  next: string;
  availabilityUnknown: string;
  book: string;
};

export function MarketplaceSalonCard({
  salon, locale, href, cityHref, labels,
}: {
  salon: SalonSearchResult;
  locale: Locale;
  href: string;
  cityHref?: string;
  labels: CardLabels;
}) {
  const description = localizedDescription(salon, locale);
  const imageUrl = publicSalonImageUrl(salon.image_url);
  const location = <><MapPin className="size-4" aria-hidden="true" />{salon.city}, {salon.postal_code} · {salon.country_code}</>;
  const timeZone = fallbackMarkets.find((market) => market.country_code === salon.country_code)?.default_time_zone ?? "UTC";

  return (
    <article className="overflow-hidden rounded-[1.75rem] border border-[#e4d6c5] bg-white shadow-[0_12px_36px_rgba(48,32,18,0.08)] dark:border-white/10 dark:bg-[#17191e]">
      {imageUrl ? (
        <div className="relative h-36 bg-[#ead7c1] dark:bg-[#473529]">
          <Image src={imageUrl} alt="" fill sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw" className="object-cover" />
        </div>
      ) : (
        <div className="grid h-36 place-items-center bg-[linear-gradient(135deg,#ead7c1,#f5ece2_52%,#dec0a1)] text-3xl font-semibold text-slate-900 dark:bg-[linear-gradient(135deg,#473529,#2b2724)] dark:text-[#efc992]">
          {salonInitials(salon.business_name)}
        </div>
      )}
      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          {salon.categories.map((item) => (
            <span key={item} className="rounded-full bg-[#f3e8dc] px-3 py-1 text-xs font-semibold text-[#7b4b24] dark:bg-[#342b23] dark:text-[#efc992]">
              {item === "hair" ? labels.hair : item === "nails" ? labels.nails : labels.other}
            </span>
          ))}
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.035em]">{salon.business_name}</h2>
        {cityHref ? (
          <Link href={cityHref} className="mt-2 flex min-h-10 items-center gap-2 text-sm text-slate-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:text-stone-300">{location}</Link>
        ) : (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-stone-400">{location}</p>
        )}
        {description ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-stone-300">{description}</p> : null}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#eee4d8] pt-4 text-sm dark:border-white/10">
          <span>
            <span className="block text-xs text-slate-500 dark:text-stone-400">{salon.starting_price === null ? labels.price : labels.from}</span>
            <strong>{salon.starting_price === null ? labels.priceUnavailable : formatMinorMoney(salon.starting_price, salon.currency, locale)}</strong>
          </span>
          <span>
            <span className="block text-xs text-slate-500 dark:text-stone-400">{labels.next}</span>
            <strong className="flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {salon.next_available_at ? formatLocalDateTime(salon.next_available_at, locale, timeZone) : labels.availabilityUnknown}
            </strong>
          </span>
        </div>
        <Link href={href} className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b77a42] dark:bg-[#e7b779] dark:text-slate-950">
          {labels.book}
        </Link>
      </div>
    </article>
  );
}
