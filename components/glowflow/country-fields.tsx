"use client";

import { useMemo, useState } from "react";

import { inputClass } from "@/components/glowflow/auth-shell";
import { marketName, type Market } from "@/lib/markets";
import type { Locale } from "@/lib/i18n";

export function CountryFields({ locale, markets }: { locale: Locale; markets: Market[] }) {
  const [countryCode, setCountryCode] = useState(markets[0]?.country_code ?? "FR");
  const selectedMarket = useMemo(
    () => markets.find((market) => market.country_code === countryCode) ?? markets[0],
    [countryCode, markets],
  );

  if (!selectedMarket) return null;

  const regionLabel =
    selectedMarket.country_code === "US"
      ? "State"
      : locale === "fr"
        ? "Région"
        : locale === "es"
          ? "Región"
          : "Region";

  return (
    <>
      <label className="block text-sm font-medium">
        Country
        <select
          className={`${inputClass} mt-2`}
          name="country_code"
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          required
        >
          {markets.map((market) => (
            <option key={market.country_code} value={market.country_code}>
              {marketName(market, locale)} · {market.currency}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Time zone
        <select className={`${inputClass} mt-2`} name="time_zone" defaultValue={selectedMarket.default_time_zone} key={countryCode} required>
          {selectedMarket.supported_time_zones.map((timeZone) => (
            <option key={timeZone} value={timeZone}>{timeZone.replaceAll("_", " ")}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Salon address
        <input className={`${inputClass} mt-2`} name="address_line1" autoComplete="street-address" minLength={3} required />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          City
          <input className={`${inputClass} mt-2`} name="city" autoComplete="address-level2" minLength={2} required />
        </label>
        <label className="block text-sm font-medium">
          {regionLabel}
          <input className={`${inputClass} mt-2`} name="administrative_area" autoComplete="address-level1" required={selectedMarket.country_code === "US"} />
        </label>
      </div>
      <label className="block text-sm font-medium">
        {selectedMarket.address_format.postal_code_label ?? "Postal code"}
        <input
          className={`${inputClass} mt-2`}
          name="postal_code"
          autoComplete="postal-code"
          pattern={selectedMarket.address_format.postal_code_pattern}
          required
        />
      </label>
    </>
  );
}
