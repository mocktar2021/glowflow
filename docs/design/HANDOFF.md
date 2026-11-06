# GlowFlow redesign handoff: "Porcelain & Mulberry"

Prepared 5 November 2026 for the GlowFlow codebase (github.com/mocktar2021/glowflow, Next.js 16, Tailwind v4, shadcn, next-intl).

Everything in this folder is a reference or a drop-in file. The static HTML screens are the visual source of truth; the files in `tokens/` are production code.

## 1. What is in this package

| Folder | Contents | How to use it |
|---|---|---|
| `brand/logo/` | Wordmark (light, dark, mono ink, mono white), mark, app icon (light, dark), favicon SVG | Copy into `public/brand/`. In React use `tokens/logo.tsx` instead of `<img>` where colour must follow the theme |
| `brand/png/` | `favicon.ico` (16/32/48), `icon-16/32/48.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `og-glowflow.png/.jpg` (1200x630), wordmark PNGs | Replace the matching files in `public/` (same names as today where they exist) |
| `brand/fonts/` | Jost and Cormorant Garamond woff2 | Only for the static mockups. Production uses `next/font` (see `tokens/fonts.ts`) |
| `tokens/globals.css` | Full theme, drop-in replacement for `app/globals.css` | Compiled and verified with Tailwind 4.2.1 |
| `tokens/fonts.ts` | `next/font/google` setup for Jost and Cormorant Garamond | Save as `app/fonts.ts` |
| `tokens/logo.tsx` | `<LogoWordmark>` and `<LogoMark>` React components | Save as `components/glowflow/logo.tsx`. Typechecked (strict) |
| `tokens/tokens.json` | All values in one machine-readable file, incl. measured contrast ratios | Reference |
| `motion/` | 3 videos in MP4 (H.264) and WebM (VP9) plus poster JPGs | Copy to `public/motion/` |
| `screens/*.html` | High-fidelity static screens | Open in a browser; rebuild them in React with the tokens |
| `screens/png/` | Desktop and mobile screenshots of every screen | Quick visual reference |
| `screens/photos/` | Original, photorealistic illustrative salon imagery | Replaces tonal photo placeholders in search, profile, and the salon workspace mockup |

## 2. Confirmed facts (checked in the repo or measured)

- The theme lives in `app/globals.css`; shadcn variable names are kept identical, so `components/ui/*` needs no changes to pick up the new look.
- Fonts today: `--font-sans` is Arial while `body` asks for Inter, which is never loaded. `tokens/fonts.ts` fixes both.
- Dark mode today is `prefers-color-scheme` only. `next-themes` is already a dependency, so class-based dark mode costs one provider.
- Hardcoded hex classes (for example `bg-[#faf9f6]`) are spread across pages. The heaviest files: `components/glowflow/dashboard-shell.tsx` (52), `app/[locale]/page.tsx` (44), `live-booking-flow.tsx` (27), `booking-flow.tsx` (25), `salons/(search)/page.tsx` (25), `dashboard/calendar/page.tsx` (20).
- The current logo is an inline lucide `Sparkles` icon in a slate tile. It is replaced entirely.
- `.codex/skills/glowflow/SKILL.md` currently tells agents to "preserve the cream, dark-slate and rose-gold identity". This conflicts with the redesign and must be updated first (text in section 6).
- All text colour pairs pass WCAG AA; most pass AAA (ratios in `tokens.json`).
- Video sizes: hero loop 318 KB MP4 / 245 KB WebM (10 s, 1600x1000, seamless loop), booking flow 250 KB / 221 KB (9.5 s, 1080x1350), logo reveal 304 KB / 131 KB (5 s, 1920x1080). All silent.

## 3. Brand system

**Logo.** A monoline geometric wordmark in the spirit of the "glow" reference: circular bowls, a single-storey "g" with a flat horizontal tail, and a thin champagne halo arcing over the first "o". The halo is the only "glow"; there are no sparkles, stars or gradients. The compact mark is the "g" with its halo. Minimum sizes: wordmark 72 px wide, mark 16 px (use `glowflow-favicon.svg`, heavier stroke, below 48 px). Clear space: the height of the "o" on every side. Never recolour the halo to mulberry, never add effects.

**Colour roles.**
- Porcelain `#FAF6F1` page, white cards, linen `#F3ECE4` for quiet surfaces and sidebars.
- Ink `#2A2129` for text; muted `#6E5F68` for secondary text.
- Mulberry `#7A4659` is the only action colour (primary buttons, links, selected states, focus rings at 45 percent).
- Blush `#F2DDD6` for selected nav, soft badges, highlights.
- Champagne `#C8A27A` is decorative only (halo, thin rules, stars). Use `#8A6A44` when champagne must be text (eyebrows).
- Status: confirmed sage, pending champagne, cancelled brick, walk-in blush (CSS variables `--status-*`).
- Dark mode: plum-black `#1D171C`, primary flips to rose `#E6BAC6` with ink text.

**Type.** Cormorant Garamond 500 for headings, with at most one italic word per heading in mulberry ("More room for your *craft*."). Jost for all UI and body. Headings are large and light; weight never carries the luxury, whitespace does.

**Shape and depth.** Pill buttons (48 px, 38 px small), 14 px inputs, 20 px cards, 28 to 32 px hero frames. Hairline borders `#E6DBD0`. Shadows are long and soft (`shadow-lift`) and only on floating elements.

**Icons.** `lucide-react` at `strokeWidth={1.6}`. Banned: `Sparkles`, `Wand`, `Stars`, `Bot`, and any "AI" wording, neon, purple to blue gradients, glassmorphism.

**Motion.** Slow and small: 180 / 280 / 600 ms, `cubic-bezier(.22,.61,.36,1)`, fade plus 8 to 14 px rise. No bounce, no parallax. Honour `prefers-reduced-motion` (CSS in `globals.css`; for videos, pause and show the poster).

**Copy.** No em dashes anywhere (owner rule). Use commas, colons or full stops. Calm, specific verbs: "Create your workspace", "Explore salons", "Book", "Continue". French stays the default locale; every new string needs fr, en, es.

## 4. Videos and where they go

| File | Where | Markup |
|---|---|---|
| `glowflow-hero-loop` | Landing hero, right column (desktop). On mobile use `glowflow-hero-loop-960.mp4` | `<video autoPlay muted loop playsInline preload="metadata" poster>` with WebM then MP4 sources, `aria-label` describing the action |
| `glowflow-booking-flow` | Landing "For your clients" band, and social posts (4:5) | Same, `preload="none"`, start playing when in view (IntersectionObserver) |
| `glowflow-logo-reveal` | Social, pitch decks, optional splash for marketing pages. Not for app load | Same |

Reduced motion: if `matchMedia('(prefers-reduced-motion: reduce)')` matches, render the poster `<img>` instead of `<video>`.

## 5. Screen map (mockup to route)

| Mockup | Route / component |
|---|---|
| `landing.html` | `app/[locale]/page.tsx`, copy in `lib/landing-copy.ts` |
| `salons-search.html` | `app/[locale]/salons/(search)/page.tsx`, `marketplace-salon-card.tsx`, `distance-search.tsx` |
| `salon-profile.html`, `salon-profile-mobile.html` | `app/[locale]/salons/[slug]/page.tsx` |
| `booking-mobile.html` | `app/[locale]/book/[slug]`, `booking-flow.tsx`, `live-booking-flow.tsx` |
| `workspace-today.html` | `app/[locale]/dashboard/page.tsx` (replaces the nav-card hub) |
| `workspace-calendar.html` | `dashboard/calendar` |
| `workspace-client.html` | `dashboard/clients/[id]` |
| `workspace-mobile.html` | Dashboard on phones: bottom tab bar |
| `auth-signin*.html`, `auth-register.html` | `login`, `register`, shared `auth-shell.tsx` |
| `onboarding-checklist.html` | First-run state of `dashboard/page.tsx` |
| `email-booking-confirmed.html`, `email-reminder.html` | Notification templates (`notification-template-preview.tsx`) |
| `states-and-components.html` | Component states for `components/ui/*` variants |

## 6. Recommendations (implementation order)

1. **Update agent rules first.** In `.codex/skills/glowflow/SKILL.md` replace the identity line with: "Follow the Porcelain & Mulberry brand in docs/design/HANDOFF.md: porcelain base, plum ink text, mulberry as the only action colour, blush and champagne as soft accents, Cormorant Garamond headings and Jost UI. Never use the Sparkles icon or em dashes." Copy this package to `docs/design/`.
2. **Foundation PR.** `globals.css`, `app/fonts.ts`, font variables on `<html>`, `ThemeProvider attribute="class" defaultTheme="system"` from next-themes, new icons and OG image in `public/`, `app/manifest.ts` colours (`background_color #FAF6F1`, `theme_color #7A4659`), `logo.tsx` replacing every inline Sparkles logo.
3. **Token sweep PR.** Replace every hardcoded hex class with tokens (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-blush`, `text-mulberry`, `bg-status-*`). Grep target: zero `\[#` colour classes outside `globals.css`.
4. **Landing PR.** Rebuild `landing.html` with the videos.
5. **Client-facing PR.** Search, salon profile, booking flow (mobile first).
6. **Workspace PR.** Revive `dashboard-shell.tsx` as the shared layout (sidebar on desktop, bottom tabs on mobile) and build Today, Calendar, Client detail.
7. **Auth, onboarding, emails, component states PR.**

## 7. Assumptions

- Photography: the mockups now use original, AI-generated photorealistic illustrations. These are not documentary photos of the fictional salons named in the screens and must not be presented as their actual work or premises. Use licensed, consented photos from real salons before publishing a real salon profile. The private workspace also has an illustrative salon-cover photo; never replace client avatars or records with invented people.
- Prices and names in mockups are fictional. EUR shown by default, one XOF example.
- No customer counts or testimonials were invented. The quote slot on the sign-in screen is a placeholder for a real, consented quote.
- Fonts are both on Google Fonts under the SIL Open Font License; please confirm licensing fits your use (I have not given a legal opinion).

## 8. Open questions for you

- Keep "GlowFlow" written as one lowercase word in the logo while the product name stays "GlowFlow" in copy? (Recommended: yes.)
- Should the marketplace (Explore salons) get its own lighter header, or share the marketing header?
- Is online payment launching in specific countries first? It affects whether the booking flow shows "Pay now" or "Pay at the salon".
- Trademark: I did not check whether the new logo or name is registrable; that needs qualified counsel.
- The "Continue with Google" button keeps Google's multicolour "G", as Google's sign-in branding guidelines expect. The country select shows a flag. Keep both? (Recommended: keep the Google G, drop flags in favour of country codes.)
- The component sheet adds three components not in the brief: a brick danger button, an ink "Completed" badge and a hatched "Break" block in the calendar. Recommended: make all three official.
- The reminder email has a "Turn off reminders" link. Check the wording and mechanism against the consent rules in each launch country before it ships; that is a question for qualified counsel.
- Booking steps: the progress bar shows 4 segments while the label reads "Step 1 of 3". Recommended: 3 steps, with the confirmation screen outside the count.
- Will deposits or card capture be required for some services? If yes, step 3 of the booking flow gains a payment section.
- Should "Anyone" in stylist choice show the soonest slot across the whole team? (Recommended: yes.)
- Is "Search as I move the map" on by default on the search page? (Recommended: off on mobile, on for desktop.)
- The calendar mockup shows the Day view only; Week view follows the same blocks at a narrower column width.
- Amounts use a space as the thousands separator (1 184 €). Format with `Intl.NumberFormat` per locale rather than hardcoding.
- The sign-in screen shows a client quote attributed to "Fatou Ndiaye". It is placeholder copy: replace it with a real, consented quote or remove it before launch. Do not ship invented testimonials.

## 9. Acceptance checklist

- `npm run lint`, `npm run typecheck`, `npm test` pass.
- No em dash characters in the diff: `git diff main | grep -nP "\x{2014}"` returns nothing.
- No `Sparkles` import: `grep -rn "Sparkles" app components` returns nothing.
- Every page checked at 390 px and 1440 px, in light and dark, in fr, en and es.
- Lighthouse accessibility 95 or higher on landing, search, profile, booking.
- Videos: total landing transfer under 1 MB before user interaction; posters present; reduced motion respected.
