import { handleVercelGlow56Cleanup } from "@/lib/glow56-vercel-cleanup.mjs";

// Dormant adapter only. There is deliberately no Vercel schedule configuration.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleVercelGlow56Cleanup(request);
}
