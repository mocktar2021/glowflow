export type NailPreferences = {
  shape?: string;
  productType?: string;
  shade?: string;
  designNotes?: string;
  lastInfillDate?: string;
};

// The database only guarantees that nail_preferences is a JSON object. Treat
// its contents as untrusted and display only the small, known text fields.
export function readNailPreferences(value: unknown): NailPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const text = (key: string, limit: number) => {
    const raw = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
    if (typeof raw !== "string") return undefined;
    const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
    return clean ? clean.slice(0, limit) : undefined;
  };
  const shape = text("shape", 80);
  const productType = text("product_type", 80);
  const shade = text("shade", 120);
  const designNotes = text("design_notes", 500);
  const date = Object.prototype.hasOwnProperty.call(source, "last_infill_date")
    && typeof source.last_infill_date === "string" ? source.last_infill_date.trim() : undefined;
  const match = date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const parsed = match ? new Date(`${date}T12:00:00Z`) : null;
  const lastInfillDate = parsed && !Number.isNaN(parsed.valueOf())
    && parsed.toISOString().slice(0, 10) === date ? date : undefined;
  return { shape, productType, shade, designNotes, lastInfillDate };
}
