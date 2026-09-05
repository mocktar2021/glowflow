import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = await readFile(path.join(root, "supabase/migrations/20260905023000_add_complete_public_salon_profiles.sql"), "utf8");
const publicPage = await readFile(path.join(root, "app/[locale]/salons/[slug]/page.tsx"), "utf8");
const ownerPage = await readFile(path.join(root, "app/[locale]/dashboard/public-profile/page.tsx"), "utf8");
const actions = await readFile(path.join(root, "app/[locale]/dashboard/public-profile/actions.ts"), "utf8");
const directUploadForm = await readFile(path.join(root, "app/[locale]/dashboard/public-profile/direct-upload-form.tsx"), "utf8");

test("adds complete public profile fields with bounded JSON and gallery data", () => {
  assert.match(migration, /add column opening_hours jsonb/);
  assert.match(migration, /add column team_json jsonb/);
  assert.match(migration, /add column policies_json jsonb/);
  assert.match(migration, /payment_methods <@ array\['card', 'cash', 'deposit', 'mixed'\]/);
  assert.match(migration, /cardinality\(gallery_urls\) <= 8/);
});

test("protects salon media writes by authenticated tenant owners", () => {
  assert.match(migration, /salon_public_media_owner_insert/);
  assert.match(migration, /salon_public_media_owner_update/);
  assert.match(migration, /salon_public_media_owner_delete/);
  assert.match(migration, /users\.id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /users\.role = 'owner'/);
  assert.match(migration, /users\.tenant_id::text = \(storage\.foldername\(name\)\)\[1\]/);
  assert.match(migration, /file_size_limit[\s\S]*1048576/);
});

test("keeps publication owner-controlled and validates image uploads", () => {
  assert.match(actions, /owner\.role !== "owner"/);
  assert.match(actions, /formData\.get\("is_published"\) === "on"/);
  assert.match(actions, /published_at: publish/);
  assert.match(directUploadForm, /allowedImageTypes/);
  assert.match(directUploadForm, /maximumImageBytes/);
  assert.match(actions, /galleryUrls\.length > 8/);
  assert.match(actions, /remove_gallery_urls/);
  assert.match(actions, /salon-public-media"\)\.remove/);
});

test("public route requires a published profile and localizes sharing metadata", () => {
  assert.match(publicPage, /\.eq\("is_published", true\)/);
  assert.match(publicPage, /if \(!profile\) notFound\(\)/);
  assert.match(publicPage, /openGraph:/);
  assert.match(publicPage, /application\/ld\+json/);
  assert.match(publicPage, /\/book\/\$\{profile\.slug\}/);
});

test("owner editor exposes multilingual content and cash payment settings", () => {
  assert.match(ownerPage, /name={`description_\$\{language\}`}/);
  assert.match(ownerPage, /\["cash", labels\.cash\]/);
  assert.match(ownerPage, /gallery_photos/);
  assert.match(ownerPage, /opening hours|Horaires|Horarios/i);
});

test("uploads photos directly without sending files through the Server Action", () => {
  assert.match(directUploadForm, /createClient/);
  assert.match(directUploadForm, /salon-public-media/);
  assert.match(directUploadForm, /formData\.delete\("cover_photo"\)/);
  assert.match(directUploadForm, /formData\.delete\("gallery_photos"\)/);
  assert.match(directUploadForm, /maximumImageBytes = 1024 \* 1024/);
  assert.match(actions, /uploaded_cover_url/);
  assert.match(actions, /uploaded_gallery_urls/);
  assert.match(actions, /ownedStoragePath/);
  assert.doesNotMatch(actions, /\.upload\(/);
});
