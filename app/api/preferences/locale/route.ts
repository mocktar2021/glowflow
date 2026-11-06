import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  locale: z.enum(["fr", "en", "es"]),
});

export async function POST(request: Request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    // A malformed body is an invalid request, not an application failure.
    // Never let a JSON parser error reach server logs with request content.
    return NextResponse.json({ stored: false }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ stored: false }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;

    if (!userId) {
      return NextResponse.json({ stored: false });
    }

    const { error } = await supabase
      .from("users")
      .update({ locale: parsed.data.locale })
      .eq("id", userId);

    return NextResponse.json({ stored: !error });
  } catch {
    return NextResponse.json({ stored: false });
  }
}
