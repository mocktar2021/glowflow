# Prompt for the coding agent

Copy everything below the line into your coding agent, after placing this package at `docs/design/` in the repo.

---

You are implementing the GlowFlow visual redesign ("Porcelain & Mulberry"). The full spec is `docs/design/HANDOFF.md`. Read it completely before changing code, then read `.codex/skills/glowflow/SKILL.md` and follow its workflow (Jira-keyed branch, PR, no merge without the product owner's approval).

Ground rules:
- The HTML files in `docs/design/screens/` are the visual source of truth. Rebuild them with React, the shadcn components in `components/ui`, and the Tailwind tokens from `docs/design/tokens/globals.css`. Do not copy their inline CSS into the app.
- Use theme tokens only. No hardcoded hex colour classes outside `app/globals.css`.
- Logo only through `components/glowflow/logo.tsx` (provided). Never use the lucide `Sparkles` icon, magic or AI imagery, or the word "AI" in UI copy.
- Never write an em dash in code, copy, comments or commit messages. Use commas, colons or full stops.
- Every user-facing string in fr (default), en and es.
- Mobile first: check 390 px and 1440 px, light and dark.
- Keep existing behaviour, data fetching, server actions and tests intact. This is a visual redesign, not a rewrite.

Work in this order, one PR each, and stop for review after each PR:
1. Update the identity line in `.codex/skills/glowflow/SKILL.md` as written in HANDOFF section 6, step 1.
2. Foundation: replace `app/globals.css` with the provided file, add `app/fonts.ts` and wire font variables on `<html>`, add next-themes `ThemeProvider attribute="class"`, add `components/glowflow/logo.tsx`, replace every inline logo, swap `public/` icons and OG image with `docs/design/brand/png/*`, copy `docs/design/motion/*` to `public/motion/`, update `app/manifest.ts` colours.
3. Token sweep across all files listed in HANDOFF section 2.
4. Landing page from `screens/landing.html` (videos per HANDOFF section 4, with reduced-motion fallback).
5. Marketplace search, salon profile and booking flow.
6. Workspace: revive `components/glowflow/dashboard-shell.tsx` as the dashboard layout, then Today, Calendar, Client detail.
7. Auth, onboarding checklist, email templates and component states.

After each PR run `npm run lint`, `npm run typecheck` and `npm test`, attach desktop and mobile screenshots, and confirm `git diff main | grep -P "\x{2014}"` is empty.
