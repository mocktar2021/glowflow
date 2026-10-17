"use client";

import { useState } from "react";

import type { Locale } from "@/lib/i18n";

const copy = {
  fr: {
    title: "Point sur la carte (facultatif)",
    help: "Indiquez la position du salon pour le tri par distance. Ce point devient public si vous publiez le profil. La position de l’appareil peut être approximative. Utilisez-le uniquement sur place, ou saisissez les coordonnées manuellement.",
    latitude: "Latitude",
    longitude: "Longitude",
    useDevice: "Utiliser la position de cet appareil",
    clear: "Effacer le point",
    requesting: "Recherche de la position…",
    ready: "Position ajoutée. Enregistrez le profil pour la conserver.",
    unavailable: "Position indisponible. Saisissez les coordonnées manuellement ou laissez ce champ vide.",
  },
  en: {
    title: "Map point (optional)",
    help: "Set the salon location for distance sorting. This point becomes public when you publish the profile. Device positioning may be approximate. Use this device only while at the salon, or enter coordinates manually.",
    latitude: "Latitude",
    longitude: "Longitude",
    useDevice: "Use this device’s location",
    clear: "Clear map point",
    requesting: "Finding location…",
    ready: "Location added. Save the profile to keep it.",
    unavailable: "Location unavailable. Enter coordinates manually or leave this blank.",
  },
  es: {
    title: "Punto en el mapa (opcional)",
    help: "Indica la ubicación del salón para ordenar por distancia. Este punto será público si publicas el perfil. La ubicación del dispositivo puede ser aproximada. Úsalo solo si estás en el salón o introduce las coordenadas manualmente.",
    latitude: "Latitud",
    longitude: "Longitud",
    useDevice: "Usar la ubicación de este dispositivo",
    clear: "Borrar el punto",
    requesting: "Buscando ubicación…",
    ready: "Ubicación añadida. Guarda el perfil para conservarla.",
    unavailable: "Ubicación no disponible. Introduce las coordenadas manualmente o deja estos campos vacíos.",
  },
} as const;

export function MapPointControl({ locale, initialLatitude, initialLongitude }: {
  locale: Locale;
  initialLatitude: number | null;
  initialLongitude: number | null;
}) {
  const labels = copy[locale];
  const [latitude, setLatitude] = useState(initialLatitude === null ? "" : String(initialLatitude));
  const [longitude, setLongitude] = useState(initialLongitude === null ? "" : String(initialLongitude));
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<"idle" | "requesting" | "ready" | "unavailable">("idle");

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    setStatus("requesting");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
          setStatus("unavailable");
          return;
        }
        setLatitude(coords.latitude.toFixed(6));
        setLongitude(coords.longitude.toFixed(6));
        setConfirmed(true);
        setStatus("ready");
      },
      () => setStatus("unavailable"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
    );
  }

  return (
    <div className="mt-5 rounded-2xl border border-[#eadfce] p-4 dark:border-white/10">
      <input type="hidden" name="map_point_confirmed" value={confirmed ? "yes" : "no"} />
      <h3 className="text-base font-semibold">{labels.title}</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-stone-300">{labels.help}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">{labels.latitude}
          <input name="map_latitude" type="number" inputMode="decimal" step="any" min="-90" max="90" value={latitude} onChange={(event) => { setLatitude(event.target.value); setConfirmed(true); }} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5" />
        </label>
        <label className="text-sm font-medium">{labels.longitude}
          <input name="map_longitude" type="number" inputMode="decimal" step="any" min="-180" max="180" value={longitude} onChange={(event) => { setLongitude(event.target.value); setConfirmed(true); }} className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={useDeviceLocation} disabled={status === "requesting"} className="min-h-11 rounded-xl border border-[#cdbba6] px-4 py-2 text-sm font-semibold hover:bg-[#faf5ed] disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10">{labels.useDevice}</button>
        <button type="button" onClick={() => { setLatitude(""); setLongitude(""); setConfirmed(true); setStatus("idle"); }} className="min-h-11 rounded-xl px-4 py-2 text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]">{labels.clear}</button>
      </div>
      {status !== "idle" ? <p role="status" className="mt-3 text-sm text-slate-600 dark:text-stone-300">{labels[status]}</p> : null}
    </div>
  );
}
