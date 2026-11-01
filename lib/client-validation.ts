import { z } from "zod";

export const clientIdSchema = z.string().uuid();
export const searchSchema = z.string().trim().max(80).regex(/^[\p{L}\p{M}\p{N}\s@.+()'\-]*$/u);
export const clientSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.union([z.literal(""), z.string().trim().email().max(160)]),
  phone: z.string().trim().max(40).refine((value) => !value || (/^\+?[\d\s().-]+$/.test(value) && (value.match(/\d/g)?.length ?? 0) >= 7 && (value.match(/\d/g)?.length ?? 0) <= 15)),
  notes: z.string().trim().max(2000),
  preferred_locale: z.enum(["fr", "en", "es"]),
});

export function clientFields(formData: FormData) {
  const field = (key: string) => String(formData.get(key) ?? "").trim();
  return clientSchema.safeParse({
    full_name: field("full_name"), email: field("email"), phone: field("phone"),
    notes: field("notes"), preferred_locale: field("preferred_locale"),
  });
}
