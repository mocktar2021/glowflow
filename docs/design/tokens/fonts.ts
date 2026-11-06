// app/fonts.ts
// Replaces the Arial / unloaded-Inter conflict. Import in app/[locale]/layout.tsx and
// add `${jost.variable} ${cormorant.variable}` to the <html> className.
import { Cormorant_Garamond, Jost } from "next/font/google";

export const jost = Jost({
  subsets: ["latin", "latin-ext"],
  variable: "--font-jost",
  display: "swap",
});

export const cormorant = Cormorant_Garamond({
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});
