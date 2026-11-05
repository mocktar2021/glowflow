import { NextResponse } from "next/server";

import { publicBookingForwardedHeaderShape } from "@/lib/public-booking-quota-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" };

export function GET(request: Request) {
  // Temporary QA probe. Never expose it in production or while booking v2 is on.
  if (process.env.VERCEL_ENV !== "preview"
    || process.env.GLOWFLOW_PUBLIC_BOOKING_HEADER_DIAGNOSTIC_ENABLED !== "true"
    || process.env.GLOWFLOW_PUBLIC_BOOKING_V2_ENABLED === "true") {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }

  // No database, cookie, token, HMAC, or raw address is read or returned.
  return NextResponse.json(publicBookingForwardedHeaderShape(request), { headers });
}
