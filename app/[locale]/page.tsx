import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, Check, Globe2, Package2, Sparkles, UsersRound } from "lucide-react";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { isLocale } from "@/lib/i18n";
import { landingCopy } from "@/lib/landing-copy";
import { supportEmail } from "@/lib/legal-content";

const primaryAction = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0f172a] px-6 py-3 text-center text-sm font-semibold text-white shadow-sm outline-offset-4 transition-colors hover:bg-[#26364f] focus-visible:outline-2 focus-visible:outline-[#a56d37]";
const secondaryAction = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#bba17f] bg-white px-6 py-3 text-center text-sm font-semibold text-[#172033] outline-offset-4 transition-colors hover:bg-[#f7efe5] focus-visible:outline-2 focus-visible:outline-[#a56d37]";
const eyebrow = "text-xs font-bold uppercase tracking-[0.2em] text-[#855124]";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const copy = landingCopy[locale];
  return {
    title: copy.hero.title,
    description: copy.hero.body,
    alternates: {
      canonical: `/${locale}`,
      languages: { fr: "/fr", en: "/en", es: "/es" },
    },
  };
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const copy = landingCopy[locale];
  const featureIcons = [CalendarDays, UsersRound, Package2] as const;

  return (
    <div className="overflow-x-clip bg-[#faf9f6] text-[#0f172a]">
      <a href="#main" className="sr-only rounded-md bg-white p-3 text-[#0f172a] focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-[#a56d37]">{copy.skip}</a>
      <header className="relative z-10 border-b border-[#e7ddd0] bg-[#faf9f6]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href={`/${locale}`} className="inline-flex min-h-11 items-center gap-2 rounded-md text-xl font-bold tracking-tight outline-offset-4 focus-visible:outline-2 focus-visible:outline-[#a56d37]">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#0f172a] text-[#e7b779]"><Sparkles className="size-5" aria-hidden="true" /></span>
            GlowFlow
          </Link>
          <nav aria-label="GlowFlow" className="order-3 flex w-full items-center gap-5 overflow-x-auto whitespace-nowrap text-sm font-medium text-[#334155] sm:order-none sm:w-auto lg:gap-7">
            <a className="min-h-11 py-3 hover:text-[#855124] focus-visible:outline-2 focus-visible:outline-[#a56d37]" href="#product">{copy.nav.product}</a>
            <a className="min-h-11 py-3 hover:text-[#855124] focus-visible:outline-2 focus-visible:outline-[#a56d37]" href="#marketplace">{copy.nav.marketplace}</a>
            <a className="min-h-11 py-3 hover:text-[#855124] focus-visible:outline-2 focus-visible:outline-[#a56d37]" href="#pricing">{copy.nav.pricing}</a>
            <a className="min-h-11 py-3 hover:text-[#855124] focus-visible:outline-2 focus-visible:outline-[#a56d37]" href="#faq">{copy.nav.faq}</a>
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href={`/${locale}/login`} className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-[#334155] hover:text-[#855124] focus-visible:outline-2 focus-visible:outline-[#a56d37]">{copy.nav.signIn}</Link>
            <LanguageSwitcher locale={locale} />
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-7xl items-center gap-10 px-5 pb-20 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1.06fr_0.94fr] lg:gap-14 lg:py-24" aria-labelledby="hero-title">
          <div className="motion-safe:animate-[landing-rise_700ms_ease-out_both]">
            <p className={eyebrow}>{copy.hero.eyebrow}</p>
            <h1 id="hero-title" className="mt-5 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl lg:text-[4.25rem]">{copy.hero.title}</h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-[#475569]">{copy.hero.body}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link className={primaryAction} href={`/${locale}/register`}>{copy.start}<ArrowRight className="size-4" aria-hidden="true" /></Link>
              <Link className={secondaryAction} href={`/${locale}/salons`}>{copy.browse}</Link>
            </div>
            <ul className="mt-9 grid gap-3 text-sm font-medium text-[#334155] sm:grid-cols-3">
              {copy.hero.points.map((point) => <li key={point} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#855124]" aria-hidden="true" />{point}</li>)}
            </ul>
          </div>
          <figure className="relative min-h-[380px] overflow-hidden rounded-[2rem] bg-[#e9d9c8] shadow-[0_24px_80px_rgba(38,27,19,0.16)] sm:min-h-[520px] lg:min-h-[600px] motion-safe:animate-[landing-rise_800ms_100ms_ease-out_both]">
            <Image src="/glowflow-manicure.png" alt={copy.hero.imageAlt} fill priority sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover object-center" />
            <figcaption className="absolute bottom-5 left-5 right-5 rounded-2xl bg-[#0f172a]/90 px-5 py-4 text-sm font-medium text-white backdrop-blur-sm sm:bottom-7 sm:left-7 sm:right-auto">{copy.hero.imageCaption}</figcaption>
          </figure>
        </section>

        <section id="product" className="scroll-mt-8 bg-[#f1e9de] px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="product-title">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className={eyebrow}>{copy.product.eyebrow}</p>
              <h2 id="product-title" className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{copy.product.title}</h2>
              <p className="mt-5 text-lg leading-relaxed text-[#475569]">{copy.product.body}</p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {copy.product.features.map((feature, index) => {
                const Icon = featureIcons[index];
                return <article key={feature.title} className="rounded-[1.5rem] border border-[#dcccb9] bg-white p-7 shadow-sm motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1">
                  <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-[#f5e9db] text-[#855124]"><Icon className="size-6" aria-hidden="true" /></span>
                  <h3 className="mt-6 text-xl font-semibold">{feature.title}</h3>
                  <p className="mt-3 leading-relaxed text-[#475569]">{feature.body}</p>
                </article>;
              })}
            </div>
            <figure className="mt-10 overflow-hidden rounded-[1.75rem] bg-[#0f172a] p-5 text-white shadow-[0_25px_70px_rgba(15,23,42,0.18)] sm:p-8 lg:p-10" aria-label={copy.product.demoLabel}>
              <div className="grid gap-6 md:grid-cols-[180px_1fr]">
                <div className="flex items-center gap-5 border-b border-white/20 pb-5 text-sm md:block md:border-b-0 md:border-r md:pb-0">
                  <span className="font-bold text-[#e7b779]">GlowFlow</span>
                  <span className="md:mt-8 md:block">{copy.product.demoCalendar}</span>
                  <span className="md:mt-5 md:block">{copy.product.demoClients}</span>
                  <span className="hidden md:mt-5 md:block">{copy.product.demoServices}</span>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-4"><span className="text-xl font-semibold">{copy.product.demoDay}</span><span className="rounded-full border border-[#e7b779]/60 px-3 py-1 text-xs text-[#f7d5a5]">{copy.product.demoCalendar}</span></div>
                  <div className="mt-6 grid gap-3 sm:grid-cols-[100px_1fr] sm:items-center">
                    <span className="text-sm text-[#cbd5e1]">10:00</span>
                    <div className="rounded-xl border-l-4 border-[#e7b779] bg-white/10 px-5 py-4"><p className="font-semibold">{copy.product.demoAppointment}</p><p className="mt-1 text-sm text-[#cbd5e1]">{copy.product.demoService}</p></div>
                    <span className="text-sm text-[#cbd5e1]">11:30</span>
                    <div className="h-12 rounded-xl border border-dashed border-white/25" aria-hidden="true" />
                  </div>
                </div>
              </div>
              <figcaption className="mt-6 border-t border-white/20 pt-4 text-xs text-[#cbd5e1]">{copy.product.demoNote}</figcaption>
            </figure>
          </div>
        </section>

        <section id="marketplace" className="scroll-mt-8 px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="marketplace-title">
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2 lg:gap-20">
            <div>
              <p className={eyebrow}>{copy.marketplace.eyebrow}</p>
              <h2 id="marketplace-title" className="mt-4 max-w-xl text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{copy.marketplace.title}</h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#475569]">{copy.marketplace.body}</p>
              <p className="mt-5 flex items-start gap-2 font-medium text-[#334155]"><Check className="mt-1 size-5 shrink-0 text-[#855124]" aria-hidden="true" />{copy.marketplace.detail}</p>
              <Link className={`${secondaryAction} mt-8`} href={`/${locale}/salons`}>{copy.browse}<ArrowRight className="size-4" aria-hidden="true" /></Link>
            </div>
            <div className="rounded-[2rem] bg-[#e9d6c4] p-5 sm:p-9">
              <div className="rounded-[1.5rem] border border-[#d9c4ae] bg-white p-6 shadow-[0_20px_45px_rgba(47,32,18,0.12)] sm:p-8">
                <div className="flex items-center justify-between gap-3 border-b border-[#e7ddd0] pb-5"><span className="font-bold">GlowFlow</span><Globe2 className="size-5 text-[#855124]" aria-hidden="true" /></div>
                <p className="mt-7 text-xs font-bold uppercase tracking-[0.2em] text-[#855124]">{copy.proof.eyebrow}</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight">{copy.proof.title}</h3>
                <p className="mt-4 leading-relaxed text-[#475569]">{copy.proof.body}</p>
                <Link href={`/${locale}/salons`} className="mt-6 inline-flex min-h-11 items-center gap-2 font-semibold text-[#855124] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[#a56d37]">{copy.browse}<ArrowRight className="size-4" aria-hidden="true" /></Link>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-8 bg-[#0f172a] px-5 py-20 text-white sm:px-8 lg:py-24" aria-labelledby="pricing-title">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 lg:flex-row lg:items-center">
            <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#e7b779]">{copy.pricing.eyebrow}</p><h2 id="pricing-title" className="mt-4 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{copy.pricing.title}</h2><p className="mt-5 text-lg leading-relaxed text-[#cbd5e1]">{copy.pricing.body}</p></div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col"><Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#e7b779] px-6 py-3 text-sm font-semibold text-[#0f172a] outline-offset-4 hover:bg-[#f4d1a1] focus-visible:outline-2 focus-visible:outline-[#e7b779]" href={`/${locale}/register`}>{copy.start}<ArrowRight className="size-4" aria-hidden="true" /></Link><a className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/60 px-6 py-3 text-sm font-semibold text-white outline-offset-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e7b779]" href={`mailto:${supportEmail}?subject=GlowFlow%20pricing`}>{copy.pricing.ask}</a></div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-8 px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="faq-title">
          <div className="mx-auto max-w-4xl"><p className={eyebrow}>{copy.faq.eyebrow}</p><h2 id="faq-title" className="mt-4 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{copy.faq.title}</h2><div className="mt-10 divide-y divide-[#d9c4ae] border-y border-[#d9c4ae]">{copy.faq.items.map((item) => <details key={item.question} className="group py-5"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 rounded-md text-lg font-semibold marker:hidden focus-visible:outline-2 focus-visible:outline-[#a56d37] [&::-webkit-details-marker]:hidden">{item.question}<span className="shrink-0 text-2xl font-normal text-[#855124] group-open:rotate-45" aria-hidden="true">+</span></summary><p className="max-w-2xl pb-2 pr-8 leading-relaxed text-[#475569]">{item.answer}</p></details>)}</div></div>
        </section>

        <section className="bg-[#f1e9de] px-5 py-20 text-center sm:px-8" aria-labelledby="closing-title"><div className="mx-auto max-w-3xl"><Sparkles className="mx-auto size-8 text-[#855124]" aria-hidden="true" /><h2 id="closing-title" className="mt-5 text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{copy.closing.title}</h2><p className="mt-5 text-lg text-[#475569]">{copy.closing.body}</p><Link className={`${primaryAction} mt-8`} href={`/${locale}/register`}>{copy.start}<ArrowRight className="size-4" aria-hidden="true" /></Link></div></section>
      </main>
    </div>
  );
}
