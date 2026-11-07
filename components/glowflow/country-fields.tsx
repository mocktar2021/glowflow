"use client";

import { useMemo, useState } from "react";

import { inputClass } from "@/components/glowflow/auth-shell";
import { marketName, marketPostalCodeLabel, type Market } from "@/lib/markets";
import type { Locale } from "@/lib/i18n";

export function CountryFields({ locale, markets }: { locale: Locale; markets: Market[] }) {
  // Language is not a reliable operating-country choice. Require an explicit selection.
  const [countryCode, setCountryCode] = useState("");
  const selectedMarket = useMemo(
    () => markets.find((market) => market.country_code === countryCode),
    [countryCode, markets],
  );

  const labels = {
    fr: { country: "Pays", chooseCountry: "Choisir un pays", timeZone: "Fuseau horaire", address: "Adresse du salon", city: "Ville", region: "Région", state: "État" },
    en: { country: "Country", chooseCountry: "Choose a country", timeZone: "Time zone", address: "Salon address", city: "City", region: "Region", state: "State" },
    es: { country: "País", chooseCountry: "Elegir un país", timeZone: "Zona horaria", address: "Dirección del salón", city: "Ciudad", region: "Región", state: "Estado" },
  }[locale];
  const regionLabel = selectedMarket?.country_code === "US" ? labels.state : labels.region;

  return (
    <>
      <label className="block text-sm font-medium">
        {labels.country}
        <select
          className={`${inputClass} mt-2`}
          name="country_code"
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          required
        >
          <option value="" disabled>{labels.chooseCountry}</option>
          {markets.map((market) => (
            <option key={market.country_code} value={market.country_code}>
              {marketName(market, locale)} · {market.currency}
            </option>
          ))}
        </select>
      </label>
      {selectedMarket ? <>
        <label className="block text-sm font-medium">
          {labels.timeZone}
          <select className={`${inputClass} mt-2`} name="time_zone" defaultValue={selectedMarket.default_time_zone} key={countryCode} required>
            {selectedMarket.supported_time_zones.map((timeZone) => (
              <option key={timeZone} value={timeZone}>{timeZone.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {labels.address}
          <input className={`${inputClass} mt-2`} name="address_line1" autoComplete="street-address" minLength={3} required />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            {labels.city}
            <input className={`${inputClass} mt-2`} name="city" autoComplete="address-level2" minLength={2} required />
          </label>
          <label className="block text-sm font-medium">
            {regionLabel}
            <input className={`${inputClass} mt-2`} name="administrative_area" autoComplete="address-level1" required={selectedMarket.country_code === "US"} />
          </label>
        </div>
        <label className="block text-sm font-medium">
          {marketPostalCodeLabel(selectedMarket, locale)}
          <input
            className={`${inputClass} mt-2`}
            name="postal_code"
            autoComplete="postal-code"
            pattern={selectedMarket.address_format.postal_code_pattern}
            required
          />
        </label>
      </> : null}
    </>
  );
}
