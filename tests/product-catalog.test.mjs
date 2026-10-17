import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { localizedProductText, productDefaultLocale } from "../lib/product-localization.ts";

const migration = await readFile(new URL("../supabase/migrations/20261017162411_add_salon_product_catalog.sql", import.meta.url), "utf8");
const optionalTranslationsMigration = await readFile(new URL("../supabase/migrations/20261017174506_optional_product_translations.sql", import.meta.url), "utf8");
const ownerPage = await readFile(new URL("../app/[locale]/dashboard/products/page.tsx", import.meta.url), "utf8");
const actions = await readFile(new URL("../app/[locale]/dashboard/products/actions.ts", import.meta.url), "utf8");
const form = await readFile(new URL("../app/[locale]/dashboard/products/product-form.tsx", import.meta.url), "utf8");
const publicPage = await readFile(new URL("../app/[locale]/salons/[slug]/page.tsx", import.meta.url), "utf8");

test("catalog stores only public-safe product fields and gates rows by tenant and publication", () => {
  assert.match(migration, /create table public\.salon_products/);
  assert.doesNotMatch(migration, /stock_count|quantity_on_hand|inventory_notes/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /salon_products_public_select[\s\S]*is_published = true[\s\S]*profile\.is_published = true/);
  assert.match(migration, /private\.is_tenant_owner\(tenant_id\)/);
  assert.match(migration, /grant select \(id, tenant_id,[\s\S]*created_at\)[\s\S]*to anon/);
  assert.match(migration, /grant update \(name_json,[\s\S]*updated_at\)[\s\S]*to authenticated/);
});

test("owner can manage localized names, descriptions, alt text, image, price, currency, and publication", () => {
  assert.match(ownerPage, /owner\.role !== "owner"/);
  for (const field of ["name", "description", "alt"]) assert.ok(ownerPage.includes(`name={\`${field}_\${language}\`}`));
  assert.match(ownerPage, /name="stock_visibility"/);
  assert.match(ownerPage, /name="currency"/);
  assert.match(ownerPage, /name="product_image"/);
  assert.match(ownerPage, /value="private"/);
  assert.match(ownerPage, /value="publish"/);
  assert.match(ownerPage, /deleteProduct/);
  assert.match(actions, /\.eq\("tenant_id", tenantId\)/);
  assert.match(actions, /ownedImagePath/);
  assert.match(actions, /image_alt_required/);
  assert.match(form, /maxImageBytes = 1024 \* 1024/);
  assert.match(form, /salon-public-media/);
  assert.doesNotMatch(ownerPage, /<input required name={`name_\$\{language\}`}/);
  assert.match(actions, /name_required/);
  assert.match(optionalTranslationsMigration, /greatest\([\s\S]*name_json->>'fr'[\s\S]*name_json->>'es'/);
});

test("public profile groups published products with localized copy and responsive accessible images, without a purchase action", () => {
  assert.match(publicPage, /from\("salon_products"\)/);
  assert.match(publicPage, /\.eq\("is_published", true\)/);
  assert.match(publicPage, /productCategories\.map/);
  assert.match(publicPage, /alt={localizedProductText\(product\.image_alt_json, locale, productFallbackLocale\)}/);
  assert.match(publicPage, /sizes="\(max-width: 640px\) 100vw/);
  assert.match(publicPage, /online purchasing is not available/i);
  assert.doesNotMatch(publicPage, /\/checkout.*product|addToCart|buyProduct/);
});

test("product copy follows the selected language, then the country default, then an entered translation", () => {
  assert.equal(productDefaultLocale("en"), "en");
  assert.equal(productDefaultLocale("es"), "es");
  assert.equal(productDefaultLocale("unknown"), "fr");
  const names = { fr: "", en: "English name", es: "Nombre español" };
  assert.equal(localizedProductText(names, "es", "en"), "Nombre español");
  assert.equal(localizedProductText(names, "fr", "en"), "English name");
  assert.equal(localizedProductText({ fr: "", en: "", es: "Nombre español" }, "en", "fr"), "Nombre español");
  assert.equal(localizedProductText({ fr: "  ", en: "  ", es: "" }, "es", "fr"), "");
});
