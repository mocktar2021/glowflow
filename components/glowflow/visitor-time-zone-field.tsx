"use client";

import { useState, useSyncExternalStore } from "react";

import { isValidIanaTimeZone } from "@/lib/marketplace-time-zones";

type Props = {
  initialZone: string;
  detectBrowserZone: boolean;
  options: string[];
  label: string;
  help: string;
};

const noBrowserZoneSubscription = () => () => {};

export function VisitorTimeZoneField({ initialZone, detectBrowserZone, options, label, help }: Props) {
  const [manualZone, setManualZone] = useState<string | null>(null);
  const browserZone = useSyncExternalStore(noBrowserZoneSubscription, () => {
    if (!detectBrowserZone) return initialZone;
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidIanaTimeZone(browserZone) ? browserZone : initialZone;
  }, () => initialZone);
  const zone = manualZone ?? browserZone;

  const choices = options.includes(zone) ? options : [...options, zone];

  return (
    <label className="text-sm font-medium">
      {label}
      <select
        name="timeZone"
        value={zone}
        onChange={(event) => setManualZone(event.target.value)}
        className="mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5"
      >
        {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
      </select>
      <span className="mt-2 block text-xs font-normal leading-5 text-slate-600 dark:text-stone-300">{help}</span>
    </label>
  );
}
