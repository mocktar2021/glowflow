import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GlowFlow",
    short_name: "GlowFlow",
    description: "Découvrez des salons et réservez votre prochain rendez-vous beauté.",
    start_url: "/fr/salons",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#0f172a",
    lang: "fr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
