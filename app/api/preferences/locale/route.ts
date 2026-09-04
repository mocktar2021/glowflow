import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const payloadSchema = z.object({
  locale: z.enum(["fr", "en", "es"]),
});

export async function POST(request: Request) {
  const parsed = payloadSchema.safeParse(await request.json());

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
