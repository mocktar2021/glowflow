import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { isLocale } from "@/lib/i18n";

export default async function InstalledSalonSearch() {
  const preferred = (await cookies()).get("glowflow_locale")?.value;
  redirect(`/${preferred && isLocale(preferred) ? preferred : "fr"}/salons`);
}
