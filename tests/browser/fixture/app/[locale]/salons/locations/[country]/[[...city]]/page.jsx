// Test-only route: the production location page runs in this isolated fixture app.
// Its server has no Supabase credentials, so it renders the safe unavailable state.
export { default, dynamic, generateMetadata } from "@/app/[locale]/salons/locations/[country]/[[...city]]/page";
