import { handleGlow56Cleanup } from "@/lib/glow56-cleanup-handler.mjs";

// Deliberately not a Vercel Cron route. The Hobby plan cannot schedule at
// this cadence; a separately gated GitHub schedule may call this route later.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleGlow56Cleanup(request);
}
