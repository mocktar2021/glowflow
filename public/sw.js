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

// Store only the visitor's language, never a page, session, booking, or response.
// A cold installed-app launch uses /salons, which has no locale in its URL.
const localeDatabaseName = "glowflow-pwa-preferences";
const localeStoreName = "preferences";

function validLocale(value) {
  return typeof value === "string" && Object.hasOwn(offlineCopy, value);
}

function openLocaleDatabase() {
  return new Promise((resolve) => {
    if (!self.indexedDB) return resolve(null);
    let settled = false;
    function finish(database) {
      if (settled) {
        database?.close();
        return;
      }
      settled = true;
      resolve(database);
    }
    let request;
    try { request = self.indexedDB.open(localeDatabaseName, 1); }
    catch { return finish(null); }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(localeStoreName)) {
        request.result.createObjectStore(localeStoreName);
      }
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
}

async function rememberLocale(locale) {
  if (!validLocale(locale)) return false;
  const database = await openLocaleDatabase();
  if (!database) return false;
  try {
    const stored = await new Promise((resolve) => {
      let transaction;
      try {
        transaction = database.transaction(localeStoreName, "readwrite");
        transaction.objectStore(localeStoreName).put(locale, "locale");
      } catch { return resolve(false); }
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    });
    return stored;
  } finally {
    database.close();
  }
}

async function rememberedLocale() {
  const database = await openLocaleDatabase();
  if (!database) return null;
  try {
    const value = await new Promise((resolve) => {
      let request;
      try { request = database.transaction(localeStoreName, "readonly")
        .objectStore(localeStoreName).get("locale"); }
      catch { return resolve(null); }
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
    return validLocale(value) ? value : null;
  } finally {
    database.close();
  }
}

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

self.addEventListener("message", (event) => {
  if (event.data?.type !== "glowflow-locale" || !validLocale(event.data.locale)) return;
  event.waitUntil(rememberLocale(event.data.locale).then((stored) => {
    event.ports?.[0]?.postMessage({ stored });
  }));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const requestedLocale = url.pathname.split("/")[1];
  event.respondWith(fetch(request).catch(async () => {
    if (validLocale(requestedLocale)) return offlinePage(requestedLocale);
    // IndexedDB can be unavailable or evicted on a device. Bound the read so
    // an offline navigation still completes, then use the product's FR default.
    const locale = await Promise.race([
      rememberedLocale().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    return offlinePage(locale ?? "fr");
  }));
});
