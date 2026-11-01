import { ClientForm } from "@/app/[locale]/dashboard/clients/client-form";

// Test-only route that binds a foreign UUID to the real production Server Action.
export default function ForgedClientAction() {
  return <ClientForm locale="en" client={{
    id: "30000000-0000-0000-0000-000000000002",
    full_name: "Synthetic Foreign", email: "", phone: "", notes: "",
    preferred_locale: "en", created_at: "2030-01-01T00:00:00Z",
  }} />;
}
