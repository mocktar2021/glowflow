import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/[locale]/dashboard/products/actions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const tenantId = "10000000-0000-0000-0000-000000000001";
const productId = "81000000-0000-0000-0000-000000000010";

function actions() {
  const inserted = [];
  const supabase = { from(table) {
    const query = {
      select() { return query; },
      eq() { return query; },
      async single() {
        if (table === "users") return { data: { tenant_id: tenantId, role: "owner" } };
        if (table === "tenants") return { data: { slug: "fixture-salon" } };
        return { data: { id: productId } };
      },
      async maybeSingle() { return { data: null }; },
      insert(values) { inserted.push(values); return query; },
    };
    return query;
  } };
  const loaded = { exports: {} };
  const dependencies = {
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect() { throw new Error("unexpected redirect"); } },
    "@/lib/auth": { requireUser: async () => ({ supabase, userId: "owner" }) },
  };
  new Function("require", "exports", compiled)((name) => dependencies[name] ?? require(name), loaded.exports);
  return { saveProduct: loaded.exports.saveProduct, inserted };
}

function form(fields = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    product_id: productId,
    name_fr: "", name_en: "", name_es: "",
    description_fr: "", description_en: "", description_es: "",
    alt_fr: "", alt_en: "", alt_es: "",
    category: "hair", currency: "USD", stock_visibility: "not_shown",
    publication_action: "publish", price: "15.00",
    ...fields,
  })) data.set(key, value);
  return data;
}

test("owner can publish with a single chosen-language name and optional translations", async () => {
  const { saveProduct, inserted } = actions();
  assert.deepEqual(await saveProduct("en", form({ name_en: "English product", description_en: "English only" })), { saved: true });
  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0].name_json, { fr: "", en: "English product", es: "" });
  assert.deepEqual(inserted[0].description_json, { fr: "", en: "English only", es: "" });
  assert.equal(inserted[0].is_published, true);
});

test("owner save rejects missing or one-character names", async () => {
  const { saveProduct, inserted } = actions();
  assert.deepEqual(await saveProduct("en", form()), { saved: false, error: "name_required" });
  assert.deepEqual(await saveProduct("en", form({ name_es: "X" })), { saved: false, error: "invalid_product" });
  assert.equal(inserted.length, 0);
});

test("product photos need alternative text in one language, not all three", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
  try {
    const { saveProduct, inserted } = actions();
    const imageUrl = `https://fixture.supabase.co/storage/v1/object/public/salon-public-media/${tenantId}/products/${productId}/11111111-1111-4111-8111-111111111111.jpg`;
    assert.deepEqual(await saveProduct("en", form({ name_en: "English product", uploaded_image_url: imageUrl })), { saved: false, error: "image_alt_required" });
    assert.deepEqual(await saveProduct("en", form({ name_en: "English product", alt_es: "Foto del producto", uploaded_image_url: imageUrl })), { saved: true });
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0].image_alt_json.es, "Foto del producto");
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  }
});
