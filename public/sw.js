// Navigation stays network-only. In particular, never cache Auth, private salon
// pages, availability, booking, checkout, or payment responses.
const offlineCopy = {
  fr: {
    title: "GlowFlow est hors ligne",
    message: "Reconnectez-vous pour consulter les disponibilités et continuer.",
    warning: "Les réservations et les paiements ne sont pas disponibles hors ligne.",
    retry: "Réessayer",
  },
  en: {
    title: "GlowFlow is offline",
    message: "Reconnect to check availability and continue.",
    warning: "Bookings and payments are not available offline.",
    retry: "Try again",
  },
  es: {
    title: "GlowFlow está sin conexión",
    message: "Vuelve a conectarte para consultar la disponibilidad y continuar.",
    warning: "Las reservas y los pagos no están disponibles sin conexión.",
    retry: "Reintentar",
  },
};

function offlinePage(locale) {
  const copy = offlineCopy[locale];
  return new Response(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${copy.title}</title></head><body><main><h1>${copy.title}</h1><p>${copy.message}</p><p>${copy.warning}</p><a href="">${copy.retry}</a></main></body></html>`,
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const requestedLocale = url.pathname.split("/")[1];
  const locale = Object.hasOwn(offlineCopy, requestedLocale) ? requestedLocale : "fr";
  event.respondWith(fetch(request).catch(() => offlinePage(locale)));
});
