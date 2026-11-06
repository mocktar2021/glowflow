// components/glowflow/logo.tsx
// GlowFlow logo. Geometry generated from brand/logo/*.svg, do not redraw by hand.
// Ink follows currentColor (set text-foreground / text-white). The halo stays champagne
// unless `mono` is set. Dark surfaces: pass tone="dark" for the lighter champagne.
import { useId } from "react";
import { cn } from "@/lib/utils";

type Props = { className?: string; mono?: boolean; tone?: "light" | "dark"; title?: string };

function haloColor(mono?: boolean, tone?: "light" | "dark") {
  if (mono) return "currentColor";
  return tone === "dark" ? "#D9B48F" : "#C8A27A";
}

export function LogoWordmark({ className, mono, tone = "light", title = "GlowFlow" }: Props) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox="-10 20 754 260" role="img" aria-label={title} className={cn("h-7 w-auto", className)}
      style={{ ["--gf-logo-halo" as string]: haloColor(mono, tone) }}>
      <g fill="none" stroke="var(--gf-logo-ink, currentColor)" strokeWidth="14" strokeLinecap="butt"><circle cx="50" cy="150.0" r="43.0"/><path d="M93.0 100 V218 A34 34 0 0 1 59.0 252 H14"/><path d="M127.0 36 V200"/><circle cx="204" cy="150.0" r="43.0"/><clipPath id={`${uid}-cw274`}><rect x="262" y="100" width="124" height="100"/></clipPath><path clipPath={`url(#${uid}-cw274)`} strokeLinejoin="miter" d="M274 70 L298 230 L324 70 L350 230 L374 70"/><path d="M407.0 200 V72 A30 30 0 0 1 437.0 42 H451.0"/><path d="M390 107.0 H447.0"/><path d="M487.0 36 V200"/><circle cx="564" cy="150.0" r="43.0"/><clipPath id={`${uid}-cw634`}><rect x="622" y="100" width="124" height="100"/></clipPath><path clipPath={`url(#${uid}-cw634)`} strokeLinejoin="miter" d="M634 70 L658 230 L684 70 L710 230 L734 70"/></g><g fill="none" stroke="var(--gf-logo-halo, #C8A27A)"><path d="M157.93 108.51 A62.0 62.0 0 0 1 250.07 108.51" strokeWidth="7" strokeLinecap="round"/></g>
    </svg>
  );
}

export function LogoMark({ className, mono, tone = "light", title = "GlowFlow" }: Props) {
  const uid = useId().replace(/:/g, "");
  void uid;
  return (
    <svg viewBox="-60 30 220 240" role="img" aria-label={title} className={cn("h-8 w-auto", className)}
      style={{ ["--gf-logo-halo" as string]: haloColor(mono, tone) }}>
      <g fill="none" stroke="var(--gf-logo-ink, currentColor)" strokeWidth="14"><circle cx="50" cy="150.0" r="43.0"/><path d="M93.0 100 V218 A34 34 0 0 1 59.0 252 H14"/></g><g fill="none" stroke="var(--gf-logo-halo, #C8A27A)"><path d="M3.93 108.51 A62.0 62.0 0 0 1 96.07 108.51" strokeWidth="7" strokeLinecap="round"/></g>
    </svg>
  );
}
