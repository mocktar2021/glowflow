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
const photoRemovalControl = await readFile(path.join(root, "app/[locale]/dashboard/public-profile/photo-removal-control.tsx"), "utf8");
const photoUploadControls = await readFile(path.join(root, "app/[locale]/dashboard/public-profile/photo-upload-controls.tsx"), "utf8");

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
  assert.match(actions, /field\(formData, "publication_action"\)/);
  assert.match(actions, /publicationAction === "publish"/);
  assert.match(actions, /invalid_publication_action/);
  assert.match(actions, /published_at: publish/);
  assert.match(directUploadForm, /SubmitEvent/);
  assert.match(directUploadForm, /formData\.set\(submitter\.name, submitter\.value\)/);
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
  assert.match(photoUploadControls, /gallery_photos/);
  assert.match(ownerPage, /opening hours|Horaires|Horarios/i);
});

test("owner editor explains publication and provides explicit private and public actions", () => {
  assert.match(ownerPage, /name="publication_action"/);
  assert.match(ownerPage, /value="private"/);
  assert.match(ownerPage, /value="publish"/);
  assert.match(ownerPage, /Enregistrer en privé/);
  assert.match(ownerPage, /Save and publish/);
  assert.match(ownerPage, /Guardar como privado/);
  assert.doesNotMatch(ownerPage, /name="is_published"/);
  assert.doesNotMatch(ownerPage, /textarea required name=/);
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

test("keeps successful uploads when the profile action completes", () => {
  assert.match(actions, /return \{ saved: true as const \}/);
  assert.doesNotMatch(actions, /public-profile\?saved=1/);
  assert.match(directUploadForm, /const result = await action\(formData\)/);
  assert.match(directUploadForm, /window\.location\.assign/);
});

test("shows explicit, reversible photo removal actions", () => {
  assert.match(ownerPage, /PhotoRemovalControl/);
  assert.match(ownerPage, /removalPending/);
  assert.match(ownerPage, /Cette photo sera supprimée/);
  assert.match(ownerPage, /This photo will be removed/);
  assert.match(ownerPage, /Esta foto se eliminará/);
  assert.match(photoRemovalControl, /type="button"/);
  assert.match(photoRemovalControl, /aria-pressed={marked}/);
  assert.match(photoRemovalControl, /setMarked/);
  assert.match(photoRemovalControl, /name={inputName}/);
  assert.match(photoRemovalControl, /checked={marked}/);
});


test("places clear localized photo upload controls beside existing salon photos", () => {
  assert.match(ownerPage, /PhotoUploadControls/);
  assert.match(ownerPage, /galleryCount={galleryCount}/);
  assert.match(ownerPage, /Ajouter des photos/);
  assert.match(ownerPage, /Add photos/);
  assert.match(ownerPage, /Añadir fotos/);
  assert.match(photoUploadControls, /name="cover_photo"/);
  assert.match(photoUploadControls, /name="gallery_photos"/);
  assert.match(photoUploadControls, /multiple/);
  assert.match(photoUploadControls, /galleryCount \+ galleryFiles\.length}\/8/);
  assert.match(photoUploadControls, /galleryFiles\.map/);
  assert.match(photoUploadControls, /next\.length > availableSlots/);
});


test("accumulates repeated gallery selections and keeps the file input synchronized", () => {
  assert.match(photoUploadControls, /useRef<HTMLInputElement>/);
  assert.match(photoUploadControls, /new DataTransfer\(\)/);
  assert.match(photoUploadControls, /const next = \[\.\.\.galleryFiles,/);
  assert.match(photoUploadControls, /incoming\.filter/);
  assert.match(photoUploadControls, /galleryInput\.current\.files = transfer\.files/);
  assert.match(photoUploadControls, /removeGalleryFile/);
  assert.match(photoUploadControls, /galleryCount \+ galleryFiles\.length/);
  assert.match(photoUploadControls, /next\.length > availableSlots/);
  assert.match(ownerPage, /Retirer de la sélection/);
  assert.match(ownerPage, /Remove from selection/);
  assert.match(ownerPage, /Quitar de la selección/);
});
