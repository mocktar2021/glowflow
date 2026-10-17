import { CalendarDays, Clock3, CreditCard, MapPin, Phone, ShieldCheck, ShoppingBag, Sparkles, Users } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { isLocale, type Locale } from "@/lib/i18n";
import { formatLocalDateTime, formatMinorMoneyWithCurrencyPrecision } from "@/lib/markets";
import { localizedProductText, productDefaultLocale } from "@/lib/product-localization";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PublicProfile = {
  tenant_id: string; slug: string; business_name: string; description_json: Record<string, string>;
  country_code: string; city: string; postal_code: string; address_line1: string; administrative_area: string;
  public_phone: string | null; categories: string[]; image_url: string | null; gallery_urls: string[];
  next_available_at: string | null; opening_hours: Record<string, string>;
  team_json: Array<{ name?: string; role?: string }>; policies_json: Record<string, string>; payment_methods: string[];
};

type PublicProduct = {
  id: string; name_json: Record<string, string>; description_json: Record<string, string>;
  image_alt_json: Record<string, string>; category: string; image_url: string | null;
  price: number; currency: string; stock_visibility: string;
};

const productCategories = ["hair", "nails", "skincare", "accessories", "other"] as const;

const productCopy = {
  fr: { heading: "Produits du salon", notice: "À découvrir au salon ; achat en ligne non disponible.", hair: "Cheveux", nails: "Ongles", skincare: "Soins de la peau", accessories: "Accessoires", other: "Autres", available: "Disponible", unavailable: "Indisponible" },
  en: { heading: "Salon products", notice: "Explore at the salon; online purchasing is not available.", hair: "Hair", nails: "Nails", skincare: "Skincare", accessories: "Accessories", other: "Other", available: "Available", unavailable: "Unavailable" },
  es: { heading: "Productos del salón", notice: "Descúbrelos en el salón; la compra en línea no está disponible.", hair: "Cabello", nails: "Uñas", skincare: "Cuidado de la piel", accessories: "Accesorios", other: "Otros", available: "Disponible", unavailable: "No disponible" },
} as const;

const copy = {
  fr: { back: "Rechercher des salons", book: "Choisir une prestation", bookService: "Réserver cette prestation", about: "À propos", services: "Prestations", team: "Équipe", hours: "Horaires", policies: "Conditions", payments: "Paiements acceptés", location: "Adresse", map: "Ouvrir dans Maps", next: "Prochain créneau", duration: "Durée", deposit: "Acompte", card: "Carte", cash: "Espèces", mixed: "Paiement mixte", onlineDeposit: "Acompte en ligne", hair: "Coiffure", nails: "Ongles", other: "Autres", closed: "Fermé", noTeam: "Équipe présentée prochainement", noServices: "Prestations disponibles prochainement", days: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] },
  en: { back: "Search salons", book: "Choose a service", bookService: "Book this service", about: "About", services: "Services", team: "Team", hours: "Opening hours", policies: "Policies", payments: "Accepted payments", location: "Location", map: "Open in Maps", next: "Next opening", duration: "Duration", deposit: "Deposit", card: "Card", cash: "Cash", mixed: "Mixed payment", onlineDeposit: "Online deposit", hair: "Hair", nails: "Nails", other: "Other", closed: "Closed", noTeam: "Team details coming soon", noServices: "Services coming soon", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] },
  es: { back: "Buscar salones", book: "Elegir un servicio", bookService: "Reservar este servicio", about: "Información", services: "Servicios", team: "Equipo", hours: "Horarios", policies: "Políticas", payments: "Pagos aceptados", location: "Dirección", map: "Abrir en Maps", next: "Próxima disponibilidad", duration: "Duración", deposit: "Depósito", card: "Tarjeta", cash: "Efectivo", mixed: "Pago mixto", onlineDeposit: "Depósito en línea", hair: "Cabello", nails: "Uñas", other: "Otros", closed: "Cerrado", noTeam: "Próximamente se presentará el equipo", noServices: "Servicios disponibles próximamente", days: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"] },
} as const;

const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

function localized(values: Record<string, string> | null | undefined, locale: Locale) {
  return values?.[locale] || values?.fr || values?.en || values?.es || "";
}

async function loadProfile(slug: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("salon_public_profiles")
    .select("tenant_id, slug, business_name, description_json, country_code, city, postal_code, address_line1, administrative_area, public_phone, categories, image_url, gallery_urls, next_available_at, opening_hours, team_json, policies_json, payment_methods")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  return data as PublicProfile | null;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const profile = await loadProfile(slug);
  if (!profile) return { title: "Salon not found | GlowFlow", robots: { index: false, follow: false } };
  const description = localized(profile.description_json, locale);
  return {
    title: `${profile.business_name} | GlowFlow`,
    description,
    alternates: { canonical: `/${locale}/salons/${profile.slug}`, languages: { fr: `/fr/salons/${profile.slug}`, en: `/en/salons/${profile.slug}`, es: `/es/salons/${profile.slug}` } },
    openGraph: { title: profile.business_name, description, type: "website", images: profile.image_url ? [{ url: profile.image_url }] : [] },
  };
}

export default async function SalonProfilePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const profile = await loadProfile(slug);
  if (!profile) notFound();
  const labels = copy[locale];
  const supabase = await createClient();
  const [{ data: tenant }, { data: services }, { data: productRows }, { data: market }] = await Promise.all([
    supabase.from("tenants").select("time_zone").eq("id", profile.tenant_id).single(),
    supabase.from("services").select("id, title_json, duration_minutes, price, deposit_amount, currency, category").eq("tenant_id", profile.tenant_id).eq("is_active", true).order("price"),
    supabase.from("salon_products").select("id, name_json, description_json, image_alt_json, category, image_url, price, currency, stock_visibility").eq("tenant_id", profile.tenant_id).eq("is_published", true).order("created_at"),
    supabase.from("markets").select("default_locale").eq("country_code", profile.country_code).single(),
  ]);
  const products = (productRows ?? []) as PublicProduct[];
  const productLabels = productCopy[locale];
  const productFallbackLocale = productDefaultLocale(market?.default_locale);
  const timeZone = tenant?.time_zone ?? "UTC";
  const address = [profile.address_line1, profile.city, profile.administrative_area, profile.postal_code, profile.country_code].filter(Boolean).join(", ");
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  const photos = [profile.image_url, ...(profile.gallery_urls ?? [])].filter((url): url is string => Boolean(url)).slice(0, 5);
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BeautySalon", name: profile.business_name, description: localized(profile.description_json, locale), image: photos, telephone: profile.public_phone, address: { "@type": "PostalAddress", streetAddress: profile.address_line1, addressLocality: profile.city, addressRegion: profile.administrative_area, postalCode: profile.postal_code, addressCountry: profile.country_code }, url: `https://glowflow.mocktar.com/${locale}/salons/${profile.slug}` }).replace(/</g, "\\u003c");

  return (
    <main className="min-h-screen bg-[#faf9f6] text-slate-950 dark:bg-[#101216] dark:text-stone-100">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <header className="border-b border-[#e7ddd0] bg-[#faf9f6]/95 dark:border-white/10 dark:bg-[#101216]/95"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8"><Link href={`/${locale}/salons`} className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-slate-950 text-[#e7b779] dark:bg-[#e7b779] dark:text-slate-950"><Sparkles className="size-5" /></span><span><strong className="block text-lg">GlowFlow</strong><span className="text-xs text-slate-500">{labels.back}</span></span></Link><LanguageSwitcher locale={locale} /></div></header>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {photos.length ? <div className="grid h-[22rem] gap-2 overflow-hidden rounded-[1.75rem] sm:grid-cols-2 lg:grid-cols-4">{photos.map((url, index) => <div key={url} className={`relative overflow-hidden bg-[#eadfd2] ${index === 0 ? "sm:row-span-2 lg:col-span-2" : ""} ${index > 2 ? "hidden lg:block" : ""}`}><Image src={url} alt={`${profile.business_name} ${index + 1}`} fill priority={index === 0} sizes={index === 0 ? "(max-width: 640px) 100vw, 50vw" : "25vw"} className="object-cover" /></div>)}</div> : <div className="grid h-64 place-items-center rounded-[1.75rem] bg-[linear-gradient(135deg,#ead7c1,#f5ece2_52%,#dec0a1)]"><Sparkles className="size-14 text-[#9a602d]" /></div>}

        <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.7fr)]">
          <div className="space-y-7">
            <section><div className="flex flex-wrap gap-2">{profile.categories.map((category) => <span key={category} className="rounded-full bg-[#f3e8dc] px-3 py-1 text-xs font-semibold text-[#7b4b24]">{category === "hair" ? labels.hair : category === "nails" ? labels.nails : labels.other}</span>)}</div><h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{profile.business_name}</h1><p className="mt-3 flex items-center gap-2 text-slate-600 dark:text-stone-300"><MapPin className="size-4" />{profile.city}, {profile.country_code}</p></section>
            <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="text-xl font-semibold">{labels.about}</h2><p className="mt-3 whitespace-pre-line leading-7 text-slate-600 dark:text-stone-300">{localized(profile.description_json, locale)}</p></section>
            <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="text-xl font-semibold">{labels.services}</h2><div className="mt-4 divide-y divide-[#eee4d8] dark:divide-white/10">{services?.length ? services.map((service) => <div key={service.id} className="flex items-start justify-between gap-4 py-4"><div><h3 className="font-semibold">{localized(service.title_json as Record<string, string>, locale)}</h3><p className="mt-1 flex flex-wrap gap-3 text-sm text-slate-500"><span className="inline-flex items-center gap-1"><Clock3 className="size-4" />{service.duration_minutes} min</span>{service.deposit_amount > 0 ? <span>{labels.deposit}: {formatMinorMoneyWithCurrencyPrecision(service.deposit_amount, service.currency, locale)}</span> : null}</p></div><div className="shrink-0 text-right"><strong>{formatMinorMoneyWithCurrencyPrecision(service.price, service.currency, locale)}</strong><Link href={`/${locale}/book/${profile.slug}?service=${encodeURIComponent(service.id)}`} aria-label={`${labels.bookService}: ${localized(service.title_json as Record<string, string>, locale)}`} className="mt-3 block rounded-xl bg-slate-950 px-3 py-3 text-sm font-semibold text-white dark:bg-[#e7b779] dark:text-slate-950">{labels.bookService}</Link></div></div>) : <p className="py-4 text-sm text-slate-500">{labels.noServices}</p>}</div></section>
            {products.length ? <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="flex items-center gap-2 text-xl font-semibold"><ShoppingBag className="size-5 text-[#a56d37]" />{productLabels.heading}</h2><p className="mt-2 text-sm text-slate-500">{productLabels.notice}</p>{productCategories.map((category) => {
              const group = products.filter((product) => product.category === category);
              return group.length ? <div key={category} className="mt-6"><h3 className="text-lg font-semibold">{productLabels[category]}</h3><div className="mt-3 grid gap-4 sm:grid-cols-2">{group.map((product) => <article key={product.id} className="overflow-hidden rounded-2xl border border-[#eee4d8] dark:border-white/10">{product.image_url ? <div className="relative aspect-[4/3] bg-[#f3e8dc]"><Image src={product.image_url} alt={localizedProductText(product.image_alt_json, locale, productFallbackLocale)} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 320px" className="object-cover" /></div> : null}<div className="p-4"><h4 className="font-semibold">{localizedProductText(product.name_json, locale, productFallbackLocale)}</h4>{localizedProductText(product.description_json, locale, productFallbackLocale) ? <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-stone-300">{localizedProductText(product.description_json, locale, productFallbackLocale)}</p> : null}<p className="mt-3 font-semibold">{formatMinorMoneyWithCurrencyPrecision(product.price, product.currency, locale)}</p>{product.stock_visibility !== "not_shown" ? <p className="mt-1 text-xs text-slate-500">{product.stock_visibility === "available" ? productLabels.available : productLabels.unavailable}</p> : null}</div></article>)}</div></div> : null;
            })}</section> : null}
            <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="flex items-center gap-2 text-xl font-semibold"><Users className="size-5 text-[#a56d37]" />{labels.team}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{profile.team_json.length ? profile.team_json.map((member, index) => <div key={`${member.name}-${index}`} className="rounded-2xl bg-[#fbf6ef] p-4 dark:bg-white/5"><strong>{member.name}</strong><p className="mt-1 text-sm text-slate-500">{member.role}</p></div>) : <p className="text-sm text-slate-500">{labels.noTeam}</p>}</div></section>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-5 lg:self-start">
            <section className="rounded-[1.75rem] border border-[#dec9aa] bg-white p-6 shadow-[0_18px_50px_rgba(48,32,18,0.10)] dark:border-white/10 dark:bg-[#17191e]">{profile.next_available_at ? <p className="text-sm text-slate-500">{labels.next}<strong className="mt-1 flex items-center gap-2 text-base text-slate-950 dark:text-white"><CalendarDays className="size-4 text-[#a56d37]" />{formatLocalDateTime(profile.next_available_at, locale, timeZone)}</strong></p> : null}<Link href={`/${locale}/book/${profile.slug}`} className="mt-5 block rounded-xl bg-slate-950 px-5 py-3 text-center text-sm font-semibold text-white dark:bg-[#e7b779] dark:text-slate-950">{labels.book}</Link></section>
            <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="text-lg font-semibold">{labels.location}</h2><p className="mt-3 text-sm leading-6 text-slate-600 dark:text-stone-300">{address}</p>{profile.public_phone ? <a href={`tel:${profile.public_phone}`} className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#8c5728]"><Phone className="size-4" />{profile.public_phone}</a> : null}<a href={mapUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#8c5728]">{labels.map}<MapPin className="size-4" /></a></section>
            <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="text-lg font-semibold">{labels.hours}</h2><dl className="mt-3 space-y-2 text-sm">{dayKeys.map((day, index) => <div key={day} className="flex justify-between gap-3"><dt className="text-slate-500">{labels.days[index]}</dt><dd className="font-medium">{profile.opening_hours[day] || labels.closed}</dd></div>)}</dl></section>
            <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="flex items-center gap-2 text-lg font-semibold"><CreditCard className="size-5 text-[#a56d37]" />{labels.payments}</h2><div className="mt-3 flex flex-wrap gap-2">{profile.payment_methods.map((method) => <span key={method} className="rounded-full bg-[#f3e8dc] px-3 py-1 text-xs font-semibold text-[#7b4b24]">{method === "cash" ? labels.cash : method === "mixed" ? labels.mixed : method === "deposit" ? labels.onlineDeposit : labels.card}</span>)}</div></section>
            {localized(profile.policies_json, locale) ? <section className="rounded-[1.75rem] border border-[#e4d6c5] bg-white p-6 dark:border-white/10 dark:bg-[#17191e]"><h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="size-5 text-[#a56d37]" />{labels.policies}</h2><p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-stone-300">{localized(profile.policies_json, locale)}</p></section> : null}
          </aside>
        </div>
      </section>
    </main>
  );
}
