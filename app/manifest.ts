import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GlowFlow",
    short_name: "GlowFlow",
    description: "Découvrez des salons et réservez votre prochain rendez-vous beauté.",
    id: "/",
    start_url: "/fr/salons",
    scope: "/",
    display: "standalone",
    background_color: "#faf6f1",
    theme_color: "#7a4659",
    lang: "fr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
