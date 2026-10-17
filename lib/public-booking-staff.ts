type Member = { id: string; name: string };
type Service = { id: string };
type Assignment = { service_id: string; staff_id: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function publishedBookingMembers(team: unknown): Member[] {
  if (!Array.isArray(team)) return [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const members: Member[] = [];
  for (const entry of team) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const name = (entry as { name?: unknown }).name;
    const id = (entry as { booking_staff_id?: unknown }).booking_staff_id;
    if (typeof name !== "string" || typeof id !== "string" || !uuid.test(id) || name.trim().length < 2 || name.trim().length > 120) continue;
    const normalizedId = id.toLowerCase();
    const normalizedName = name.trim().toLowerCase();
    if (seenIds.has(normalizedId) || seenNames.has(normalizedName)) continue;
    seenIds.add(normalizedId);
    seenNames.add(normalizedName);
    members.push({ id: normalizedId, name: name.trim() });
  }
  return members;
}

export function bookingMembersByService(members: Member[], tenantStaffIds: string[], services: Service[], assignments: Assignment[]) {
  const owned = new Set(tenantStaffIds);
  const eligibleByService = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const eligible = eligibleByService.get(assignment.service_id) ?? new Set<string>();
    eligible.add(assignment.staff_id);
    eligibleByService.set(assignment.service_id, eligible);
  }
  return Object.fromEntries(services.map((service) => {
    const eligible = eligibleByService.get(service.id);
    return [service.id, members.filter((member) => owned.has(member.id) && (!eligible || eligible.has(member.id)))];
  })) as Record<string, Member[]>;
}
