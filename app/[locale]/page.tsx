import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, Check, Globe2, Package2, UsersRound } from "lucide-react";

import { BrandLogo } from "@/components/glowflow/brand-logo";
import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { isLocale } from "@/lib/i18n";
import { landingCopy } from "@/lib/landing-copy";
import { supportEmail } from "@/lib/legal-content";

const primaryAction = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-7 py-3 text-center text-sm font-semibold text-primary-foreground shadow-[0_12px_28px_-12px_rgba(94,52,69,0.5)] transition-colors hover:bg-[#5e3445] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary dark:hover:bg-[#f2d6de]";
const secondaryAction = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-input bg-card px-7 py-3 text-center text-sm font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";
const eyebrow = "text-xs font-semibold uppercase tracking-[0.18em] text-champagne-deep dark:text-[#d9b48f]";

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
    <div className="overflow-x-clip bg-background text-foreground">
      <a href="#main" className="sr-only rounded-md bg-card p-3 text-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-primary">{copy.skip}</a>
      <header className="relative z-10 border-b border-border/70 bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link href={`/${locale}`} className="inline-flex min-h-11 items-center rounded-md text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
            <BrandLogo className="h-9 w-28 sm:w-36" />
          </Link>
          <nav aria-label="GlowFlow" className="order-3 flex w-full items-center gap-5 overflow-x-auto whitespace-nowrap text-sm font-medium text-muted-foreground sm:order-none sm:w-auto lg:gap-7">
            <a className="min-h-11 py-3 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" href="#product">{copy.nav.product}</a>
            <a className="min-h-11 py-3 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" href="#marketplace">{copy.nav.marketplace}</a>
            <a className="min-h-11 py-3 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" href="#pricing">{copy.nav.pricing}</a>
            <a className="min-h-11 py-3 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary" href="#faq">{copy.nav.faq}</a>
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link href={`/${locale}/login`} className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-2 text-sm font-semibold text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{copy.nav.signIn}</Link>
            <LanguageSwitcher locale={locale} />
            <Link href={`/${locale}/register`} className={`${primaryAction} hidden lg:inline-flex`}>{copy.start}</Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 pb-24 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14 lg:py-28" aria-labelledby="hero-title">
          <div>
            <p className={eyebrow}>{copy.hero.eyebrow}</p>
            <h1 id="hero-title" className="motion-safe:animate-[landing-rise_600ms_100ms_ease-out_both] mt-6 max-w-3xl text-balance font-display text-6xl font-medium leading-[0.98] tracking-[-0.025em] sm:text-7xl lg:text-[5.5rem]">{copy.hero.title}</h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">{copy.hero.body}</p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link className={primaryAction} href={`/${locale}/register`}>{copy.start}<ArrowRight className="size-4" aria-hidden="true" /></Link>
              <Link className={secondaryAction} href={`/${locale}/salons`}>{copy.browse}</Link>
            </div>
            <ul className="mt-10 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              {copy.hero.points.map((point) => <li key={point} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-[#4f6b53]" aria-hidden="true" />{point}</li>)}
            </ul>
          </div>
          <figure className="relative min-h-[440px] rounded-[2rem] border border-border bg-card p-5 shadow-[0_28px_60px_-28px_rgba(94,52,69,0.26)] sm:min-h-[530px] sm:p-8" aria-label={copy.product.demoLabel}>
            <div className="rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-7">
              <div className="flex items-center justify-between border-b border-border pb-4"><BrandLogo className="h-7 w-24 text-foreground" /><span className="text-xs text-muted-foreground">{copy.product.demoDay}</span></div>
              <p className="mt-6 font-display text-3xl">{copy.product.demoCalendar}</p>
              <div className="mt-5 space-y-3">
                <div className="rounded-xl border-l-4 border-primary bg-secondary/70 px-4 py-4"><span className="text-xs text-muted-foreground">10:00</span><p className="font-semibold">{copy.product.demoAppointment}</p><p className="text-sm text-muted-foreground">{copy.product.demoService}</p></div>
                <div className="rounded-xl border border-border bg-card px-4 py-4"><span className="text-xs text-muted-foreground">11:30</span><p className="font-semibold">{copy.product.demoClients}</p></div>
              </div>
            </div>
            <div className="absolute -bottom-4 right-5 w-40 rounded-[1.7rem] border-[5px] border-foreground bg-background p-3 shadow-[0_22px_34px_-18px_rgba(42,33,41,0.45)] sm:bottom-6 sm:right-6 sm:w-48">
              <div className="mx-auto mb-4 h-2 w-14 rounded-full bg-foreground" />
              <p className="font-display text-xl">{copy.product.demoService}</p>
              <div className="mt-5 space-y-2"><span className="block h-7 rounded-full border border-border bg-card" /><span className="block h-7 rounded-full bg-primary" /><span className="block h-7 rounded-full border border-border bg-card" /></div>
              <p className="mt-5 text-center text-xs text-muted-foreground">{copy.product.demoNote}</p>
            </div>
            <figcaption className="sr-only">{copy.product.demoNote}</figcaption>
          </figure>
        </section>

        <section id="product" className="scroll-mt-8 bg-muted/60 px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="product-title">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-2xl">
              <p className={eyebrow}>{copy.product.eyebrow}</p>
              <h2 id="product-title" className="mt-4 text-balance font-display text-4xl font-medium leading-tight sm:text-6xl">{copy.product.title}</h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{copy.product.body}</p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {copy.product.features.map((feature, index) => {
                const Icon = featureIcons[index];
                return <article key={feature.title} className="rounded-[1.5rem] border border-border bg-card p-7 shadow-sm motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-1">
                  <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground"><Icon className="size-6" strokeWidth={1.6} aria-hidden="true" /></span>
                  <h3 className="mt-6 font-display text-3xl font-medium">{feature.title}</h3>
                  <p className="mt-3 leading-relaxed text-muted-foreground">{feature.body}</p>
                </article>;
              })}
            </div>
          </div>
        </section>

        <section id="marketplace" className="scroll-mt-8 px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="marketplace-title">
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-2 lg:gap-20">
            <figure className="relative min-h-[380px] overflow-hidden rounded-[2rem] bg-blush sm:min-h-[540px]">
              <Image src="/brand/illustrative-manicure.jpg" alt={copy.hero.imageAlt} fill sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover" />
              <figcaption className="absolute bottom-4 left-4 rounded-full bg-card/95 px-4 py-2 text-xs text-foreground shadow-sm sm:bottom-6 sm:left-6">{copy.hero.imageCaption}</figcaption>
            </figure>
            <div>
              <p className={eyebrow}>{copy.marketplace.eyebrow}</p>
              <h2 id="marketplace-title" className="mt-4 max-w-xl text-balance font-display text-4xl font-medium leading-tight sm:text-6xl">{copy.marketplace.title}</h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">{copy.marketplace.body}</p>
              <p className="mt-5 flex items-start gap-2 font-medium text-foreground"><Check className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" />{copy.marketplace.detail}</p>
              <Link className={`${secondaryAction} mt-8`} href={`/${locale}/salons`}>{copy.browse}<ArrowRight className="size-4" aria-hidden="true" /></Link>
              <div className="mt-9 rounded-2xl border border-border bg-card p-5 sm:p-6">
                <div className="flex items-center gap-2 text-primary"><Globe2 className="size-5" aria-hidden="true" /><span className={eyebrow}>{copy.proof.eyebrow}</span></div>
                <h3 className="mt-3 font-display text-3xl">{copy.proof.title}</h3>
                <p className="mt-2 leading-relaxed text-muted-foreground">{copy.proof.body}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-8 bg-muted/60 px-5 py-20 sm:px-8 lg:py-24" aria-labelledby="pricing-title">
          <div className="mx-auto grid max-w-7xl gap-8 overflow-hidden rounded-[2rem] border border-border bg-card lg:grid-cols-2">
            <div className="p-8 sm:p-12"><p className={eyebrow}>{copy.pricing.eyebrow}</p><h2 id="pricing-title" className="mt-4 text-balance font-display text-4xl font-medium leading-tight sm:text-6xl">{copy.pricing.title}</h2><p className="mt-5 text-lg leading-relaxed text-muted-foreground">{copy.pricing.body}</p><div className="mt-8 flex flex-wrap gap-3"><Link className={primaryAction} href={`/${locale}/register`}>{copy.start}<ArrowRight className="size-4" aria-hidden="true" /></Link><a className={secondaryAction} href={`mailto:${supportEmail}?subject=${encodeURIComponent(copy.pricing.emailSubject)}`}>{copy.pricing.ask}</a></div></div>
            <div className="relative min-h-64 overflow-hidden bg-blush lg:min-h-full"><Image src="/brand/illustrative-salon.jpg" alt="" fill sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover" /><span className="absolute bottom-4 left-4 rounded-full bg-card/95 px-4 py-2 text-xs text-foreground shadow-sm">{copy.hero.imageCaption}</span></div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-8 px-5 py-20 sm:px-8 lg:py-28" aria-labelledby="faq-title">
          <div className="mx-auto max-w-4xl"><p className={eyebrow}>{copy.faq.eyebrow}</p><h2 id="faq-title" className="mt-4 font-display text-4xl font-medium sm:text-6xl">{copy.faq.title}</h2><div className="mt-10 divide-y divide-border border-y border-border">{copy.faq.items.map((item) => <details key={item.question} className="group py-5"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-5 rounded-md text-lg font-medium marker:hidden focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">{item.question}<span className="shrink-0 text-2xl font-normal text-primary group-open:rotate-45" aria-hidden="true">+</span></summary><p className="max-w-2xl pb-2 pr-8 leading-relaxed text-muted-foreground">{item.answer}</p></details>)}</div></div>
        </section>

        <section className="px-5 pb-5 pt-10 text-center sm:px-8" aria-labelledby="closing-title"><div className="mx-auto max-w-7xl rounded-[2rem] bg-[#2a2129] px-6 py-20 text-[#f6efea] sm:px-10 sm:py-24"><BrandLogo compact className="mx-auto h-16 w-16 text-[#f6efea]" /><h2 id="closing-title" className="mx-auto mt-7 max-w-3xl text-balance font-display text-4xl font-medium leading-tight sm:text-6xl">{copy.closing.title}</h2><p className="mx-auto mt-5 max-w-xl text-lg text-[#d3c7cc]">{copy.closing.body}</p><div className="mt-8 flex flex-wrap justify-center gap-3"><Link className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#e6bac6] px-7 py-3 text-sm font-semibold text-[#2a2129] hover:bg-[#f2d6de] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e6bac6]" href={`/${locale}/register`}>{copy.start}<ArrowRight className="size-4" aria-hidden="true" /></Link><Link className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#d3c7cc]/60 px-7 py-3 text-sm font-semibold text-[#f6efea] hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e6bac6]" href={`/${locale}/salons`}>{copy.browse}</Link></div></div></section>
      </main>
    </div>
  );
}
