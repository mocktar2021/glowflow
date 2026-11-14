/**
 * Read model for a future, append-only nail-service record table.
 * `performed_on` is a salon-local SQL date, not an appointment timestamp.
 * A correction adds a new row that replaces the old row; it never edits history.
 * A paginated slice cannot establish the last infill: callers must load the
 * complete client history, including corrections, or use a database aggregate.
 */
export type NailServiceRecord = {
  id: string;
  performed_on: string;
  service_kind: "new_set" | "infill" | "removal" | "repair" | "other";
  replaces_record_id: string | null;
};

export function lastInfillDate(input: {
  records: readonly NailServiceRecord[];
  complete: true;
}): string | null {
  if (input.complete !== true) throw new Error("nail_history_incomplete");
  const records = input.records;
  const replacedIds = new Set(records.map((record) => record.replaces_record_id).filter((id): id is string => id !== null));
  let latest: string | null = null;
  for (const record of records) {
    if (record.service_kind !== "infill" || replacedIds.has(record.id)) continue;
    // SQL date values serialize as YYYY-MM-DD. Never compare locale-formatted dates.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.performed_on)) continue;
    if (latest === null || record.performed_on > latest) latest = record.performed_on;
  }
  return latest;
}
