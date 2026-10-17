import { ArrowLeft, ExternalLink, MapPin, Save, ShieldCheck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { savePublicSalonProfile } from "./actions";
import { DirectUploadProfileForm } from "./direct-upload-form";
import { PhotoRemovalControl } from "./photo-removal-control";
import { PhotoUploadControls } from "./photo-upload-controls";

export const dynamic = "force-dynamic";

const copy = {
  fr: {
    title: "Profil public du salon", subtitle: "Présentez votre salon et choisissez quand il apparaît dans la recherche.", back: "Tableau de bord", view: "Voir le profil public", saved: "Profil enregistré.", status: "Publication", published: "Publié", draft: "Privé (non publié)", currentStatus: "État actuel", publishHelp: "Choisissez comment enregistrer ce profil.", privateHelp: "Enregistrer en privé retire le salon de la recherche et empêche les nouvelles réservations publiques.", publicHelp: "Enregistrer et publier affiche le salon dans la recherche et permet aux clients de commencer une réservation.", identity: "Présentation", name: "Nom public", phone: "Téléphone public", address: "Adresse", city: "Ville", area: "Région ou État", postal: "Code postal", descriptions: "Descriptions", categories: "Catégories", hair: "Coiffure", nails: "Ongles", other: "Autres", keywords: "Produits et spécialités", keywordsHelp: "Séparez les termes par des virgules.", media: "Photos", cover: "Photo principale", gallery: "Galerie, 8 photos maximum", remove: "Supprimer", undo: "Annuler", removalPending: "Cette photo sera supprimée lorsque vous enregistrerez le profil.", mediaHelp: "JPG, PNG, WebP ou AVIF. 1 Mo maximum par photo. Les photos sont envoyées directement vers votre espace sécurisé.", addCover: "Ajouter une photo principale", replaceCover: "Remplacer la photo principale", addGallery: "Ajouter des photos", remaining: "places disponibles", selected: "Sélection", removeSelected: "Retirer de la sélection", tooMany: "Vous pouvez ajouter au maximum {count} photo(s).", hours: "Horaires", team: "Équipe", member: "Nom", role: "Rôle", payments: "Paiements acceptés", card: "Carte", cash: "Espèces", deposit: "Acompte en ligne", mixed: "Paiement mixte", policies: "Conditions du salon", savePrivate: "Enregistrer en privé", savePublish: "Enregistrer et publier", error: "Vérifiez les champs requis et les photos avant de réessayer.", batchError: "Les nouvelles photos n’ont pas pu être enregistrées.", invalidImage: "Chaque photo doit être au format JPG, PNG, WebP ou AVIF et ne pas dépasser 1 Mo.", uploadFailed: "L’envoi des photos a échoué. Réessayez.", publishIncomplete: "Pour publier, ajoutez les trois descriptions, une catégorie et un moyen de paiement.", saving: "Envoi des photos et enregistrement du profil…", days: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"], locales: ["Français", "English", "Español"] },
  en: {
    title: "Public salon profile", subtitle: "Present your salon and choose when it appears in search.", back: "Dashboard", view: "View public profile", saved: "Profile saved.", status: "Publishing", published: "Published", draft: "Private (not published)", currentStatus: "Current status", publishHelp: "Choose how to save this profile.", privateHelp: "Save as private removes the salon from search and prevents new public bookings.", publicHelp: "Save and publish lists the salon in search and lets customers start a booking.", identity: "Salon details", name: "Public name", phone: "Public phone", address: "Address", city: "City", area: "State or region", postal: "Postal code", descriptions: "Descriptions", categories: "Categories", hair: "Hair", nails: "Nails", other: "Other", keywords: "Products and specialties", keywordsHelp: "Separate terms with commas.", media: "Photos", cover: "Cover photo", gallery: "Gallery, up to 8 photos", remove: "Remove", undo: "Undo", removalPending: "This photo will be removed when you save the profile.", mediaHelp: "JPG, PNG, WebP, or AVIF. Maximum 1 MB per photo. Photos upload directly to your secure workspace.", addCover: "Add cover photo", replaceCover: "Replace cover photo", addGallery: "Add photos", remaining: "slots available", selected: "Selected", removeSelected: "Remove from selection", tooMany: "You may add up to {count} photo(s).", hours: "Opening hours", team: "Team", member: "Name", role: "Role", payments: "Accepted payments", card: "Card", cash: "Cash", deposit: "Online deposit", mixed: "Mixed payment", policies: "Salon policies", savePrivate: "Save as private", savePublish: "Save and publish", error: "Review the required fields and photos, then try again.", batchError: "The new photos could not be saved.", invalidImage: "Each photo must be JPG, PNG, WebP, or AVIF and no larger than 1 MB.", uploadFailed: "The photo upload failed. Try again.", publishIncomplete: "To publish, add all three descriptions, one category, and one payment method.", saving: "Uploading photos and saving your profile…", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], locales: ["Français", "English", "Español"] },
  es: {
    title: "Perfil público del salón", subtitle: "Presenta tu salón y elige cuándo aparece en la búsqueda.", back: "Panel", view: "Ver perfil público", saved: "Perfil guardado.", status: "Publicación", published: "Publicado", draft: "Privado (sin publicar)", currentStatus: "Estado actual", publishHelp: "Elige cómo guardar este perfil.", privateHelp: "Guardar como privado elimina el salón de la búsqueda e impide nuevas reservas públicas.", publicHelp: "Guardar y publicar muestra el salón en la búsqueda y permite a los clientes iniciar una reserva.", identity: "Datos del salón", name: "Nombre público", phone: "Teléfono público", address: "Dirección", city: "Ciudad", area: "Estado o región", postal: "Código postal", descriptions: "Descripciones", categories: "Categorías", hair: "Cabello", nails: "Uñas", other: "Otros", keywords: "Productos y especialidades", keywordsHelp: "Separa los términos con comas.", media: "Fotos", cover: "Foto principal", gallery: "Galería, máximo 8 fotos", remove: "Eliminar", undo: "Deshacer", removalPending: "Esta foto se eliminará cuando guardes el perfil.", mediaHelp: "JPG, PNG, WebP o AVIF. Máximo 1 MB por foto. Las fotos se envían directamente a tu espacio seguro.", addCover: "Añadir foto principal", replaceCover: "Cambiar foto principal", addGallery: "Añadir fotos", remaining: "espacios disponibles", selected: "Selección", removeSelected: "Quitar de la selección", tooMany: "Puedes añadir un máximo de {count} foto(s).", hours: "Horarios", team: "Equipo", member: "Nombre", role: "Función", payments: "Pagos aceptados", card: "Tarjeta", cash: "Efectivo", deposit: "Depósito en línea", mixed: "Pago mixto", policies: "Políticas del salón", savePrivate: "Guardar como privado", savePublish: "Guardar y publicar", error: "Revisa los campos obligatorios y las fotos antes de intentarlo de nuevo.", batchError: "No se pudieron guardar las fotos nuevas.", invalidImage: "Cada foto debe ser JPG, PNG, WebP o AVIF y no superar 1 MB.", uploadFailed: "La carga de fotos falló. Inténtalo de nuevo.", publishIncomplete: "Para publicar, añade las tres descripciones, una categoría y un método de pago.", saving: "Subiendo fotos y guardando tu perfil…", days: ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"], locales: ["Français", "English", "Español"] },
} as const;

const bookingCopy = {
  fr: { account: "Compte de réservation", displayOnly: "Présentation uniquement", help: "Le nom devient un choix de réservation si vous le reliez à un compte de ce salon, que le service lui est ouvert et que vous publiez le profil." },
  en: { account: "Booking account", displayOnly: "Display only", help: "A name becomes a booking choice when you link it to an account in this salon, the service is open to that account, and you publish the profile." },
  es: { account: "Cuenta de reservas", displayOnly: "Solo presentación", help: "El nombre será una opción de reserva si lo vinculas a una cuenta de este salón, el servicio está disponible para esa cuenta y publicas el perfil." },
} as const;

const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const inputClass = "mt-2 h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 outline-none focus:border-[#b77a42] focus:ring-2 focus:ring-[#b77a42]/20 dark:border-white/15 dark:bg-white/5";
const sectionClass = "rounded-[1.75rem] border border-[#e4d6c5] bg-white p-5 shadow-[0_12px_36px_rgba(48,32,18,0.06)] dark:border-white/10 dark:bg-[#17191e] sm:p-7";

export default async function PublicProfileSettingsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const labels = copy[locale];
  const query = await searchParams;
  const { supabase, userId } = await requireUser(locale);
  const { data: user } = await supabase.from("users").select("tenant_id, role").eq("id", userId).single();
  if (!user?.tenant_id || user.role !== "owner") notFound();

  const [{ data: tenant }, { data: profile }, { data: staff, error: staffError }] = await Promise.all([
    supabase.from("tenants").select("name, slug, country_code, address_line1, city, postal_code, administrative_area").eq("id", user.tenant_id).single(),
    supabase.from("salon_public_profiles").select("*").eq("tenant_id", user.tenant_id).maybeSingle(),
    supabase.from("users").select("id,full_name").eq("tenant_id", user.tenant_id).order("full_name"),
  ]);
  if (!tenant) notFound();
  if (staffError) throw new Error("Unable to load booking accounts.");

  const descriptions = (profile?.description_json ?? {}) as Record<string, string>;
  const policies = (profile?.policies_json ?? {}) as Record<string, string>;
  const hours = (profile?.opening_hours ?? {}) as Record<string, string>;
  const team = Array.isArray(profile?.team_json) ? profile.team_json as Array<{ name?: string; role?: string; booking_staff_id?: string }> : [];
  const categories = Array.isArray(profile?.categories) ? profile.categories : [];
  const payments = Array.isArray(profile?.payment_methods) ? profile.payment_methods : [];
  const galleryCount = Array.isArray(profile?.gallery_urls) ? profile.gallery_urls.length : 0;
  const galleryUrls = Array.isArray(profile?.gallery_urls) ? profile.gallery_urls as string[] : [];

  return (
    <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#9a602d] hover:underline dark:text-[#efc992]"><ArrowLeft className="size-4" />{labels.back}</Link>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{labels.title}</h1>
            <p className="mt-2 text-slate-600 dark:text-stone-300">{labels.subtitle}</p>
          </div>
          {profile?.is_published ? <Link href={`/${locale}/salons/${tenant.slug}`} target="_blank" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[#d9c7b2] bg-white px-4 text-sm font-semibold dark:border-white/15 dark:bg-white/5">{labels.view}<ExternalLink className="size-4" /></Link> : null}
        </div>

        {query.saved ? <p role="status" className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{labels.saved}</p> : null}
        {query.error ? <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{query.error === "image_batch_too_large" ? labels.batchError : labels.error}</p> : null}

        <DirectUploadProfileForm
          action={savePublicSalonProfile.bind(null, locale)}
          tenantId={user.tenant_id}
          messages={{
            invalidImage: labels.invalidImage,
            uploadFailed: labels.uploadFailed,
            publishIncomplete: labels.publishIncomplete,
            saving: labels.saving,
          }}
        >
          <section className={sectionClass}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div><h2 className="text-xl font-semibold">{labels.status}</h2><p className="mt-1 text-sm text-slate-500 dark:text-stone-400">{labels.publishHelp}</p></div>
              <p className={`rounded-full px-4 py-3 text-sm font-semibold ${profile?.is_published ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200" : "bg-[#f5ecdf] text-slate-800 dark:bg-white/10 dark:text-stone-200"}`}>
                {labels.currentStatus}: {profile?.is_published ? labels.published : labels.draft}
              </p>
            </div>
            <div className="mt-5 grid gap-3 text-sm text-slate-600 dark:text-stone-300 sm:grid-cols-2">
              <p className="rounded-2xl border border-[#e4d6c5] p-4 dark:border-white/10"><strong className="block text-slate-950 dark:text-stone-100">{labels.savePrivate}</strong>{labels.privateHelp}</p>
              <p className="rounded-2xl border border-[#e4d6c5] p-4 dark:border-white/10"><strong className="block text-slate-950 dark:text-stone-100">{labels.savePublish}</strong>{labels.publicHelp}</p>
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="flex items-center gap-2 text-xl font-semibold"><MapPin className="size-5 text-[#a56d37]" />{labels.identity}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">{labels.name}<input required name="business_name" defaultValue={profile?.business_name ?? tenant.name} className={inputClass} maxLength={120} /></label>
              <label className="text-sm font-medium">{labels.phone}<input name="public_phone" type="tel" defaultValue={profile?.public_phone ?? ""} className={inputClass} /></label>
              <label className="text-sm font-medium sm:col-span-2">{labels.address}<input required name="address_line1" defaultValue={profile?.address_line1 ?? tenant.address_line1} className={inputClass} /></label>
              <label className="text-sm font-medium">{labels.city}<input required name="city" defaultValue={profile?.city ?? tenant.city} className={inputClass} /></label>
              <label className="text-sm font-medium">{labels.area}<input name="administrative_area" defaultValue={profile?.administrative_area ?? tenant.administrative_area} className={inputClass} /></label>
              <label className="text-sm font-medium">{labels.postal}<input required name="postal_code" defaultValue={profile?.postal_code ?? tenant.postal_code} className={inputClass} /></label>
            </div>
            {profile?.image_url ? <PhotoRemovalControl inputName="remove_cover" removeLabel={labels.remove} undoLabel={labels.undo} pendingLabel={labels.removalPending} className="mt-5 rounded-2xl border border-[#dfd2c1] p-3"><span className="relative block size-20 overflow-hidden rounded-xl"><Image src={profile.image_url} alt="" fill sizes="80px" className="object-cover" /></span></PhotoRemovalControl> : null}
            {galleryUrls.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{galleryUrls.map((url, index) => <PhotoRemovalControl key={url} inputName="remove_gallery_urls" inputValue={url} removeLabel={labels.remove} undoLabel={labels.undo} pendingLabel={labels.removalPending} className="rounded-2xl border border-[#dfd2c1] p-2"><span className="relative block h-24 overflow-hidden rounded-xl"><Image src={url} alt={`${labels.gallery} ${index + 1}`} fill sizes="160px" className="object-cover" /></span></PhotoRemovalControl>)}</div> : null}
            <div className="mt-6 border-t border-[#eadfce] pt-5 dark:border-white/10">
              <h3 className="text-lg font-semibold">{labels.media}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-stone-400">{labels.mediaHelp}</p>
              <PhotoUploadControls
                hasCover={Boolean(profile?.image_url)}
                galleryCount={galleryCount}
                labels={{
                  cover: labels.cover,
                  gallery: labels.gallery,
                  addCover: labels.addCover,
                  replaceCover: labels.replaceCover,
                  addGallery: labels.addGallery,
                  remaining: labels.remaining,
                  selected: labels.selected,
                  removeSelected: labels.removeSelected,
                  tooMany: labels.tooMany,
                }}
              />
            </div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-xl font-semibold">{labels.descriptions}</h2>
            <div className="mt-5 grid gap-4">
              {(["fr", "en", "es"] as const).map((language, index) => <label key={language} className="text-sm font-medium">{labels.locales[index]}<textarea name={`description_${language}`} defaultValue={descriptions[language] ?? ""} rows={4} maxLength={1200} className={`${inputClass} h-auto py-3`} /></label>)}
            </div>
            <div className="mt-5">
              <h3 className="text-sm font-semibold">{labels.categories}</h3>
              <div className="mt-3 flex flex-wrap gap-3">{[["hair", labels.hair], ["nails", labels.nails], ["other", labels.other]].map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-full border border-[#dfd2c1] px-4 py-2 text-sm"><input type="checkbox" name="categories" value={value} defaultChecked={categories.includes(value)} className="accent-[#a56d37]" />{label}</label>)}</div>
            </div>
            <label className="mt-5 block text-sm font-medium">{labels.keywords}<input name="product_keywords" defaultValue={(profile?.product_keywords ?? []).join(", ")} className={inputClass} /><span className="mt-1 block text-xs text-slate-500">{labels.keywordsHelp}</span></label>
          </section>

          <section className={sectionClass}>
            <h2 className="text-xl font-semibold">{labels.hours}</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">{dayKeys.map((day, index) => <label key={day} className="text-sm font-medium">{labels.days[index]}<input name={`hours_${day}`} placeholder="09:00–18:00" defaultValue={hours[day] ?? ""} className={inputClass} /></label>)}</div>
          </section>

          <section className={sectionClass}>
            <h2 className="text-xl font-semibold">{labels.team}</h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-stone-400">{bookingCopy[locale].help}</p>
            <div className="mt-5 space-y-3">{[0, 1, 2].map((index) => <div key={index} className="grid gap-3 rounded-xl border border-[#eadfce] p-3 dark:border-white/10 sm:grid-cols-3"><label className="text-sm font-medium">{labels.member}<input name={`team_${index + 1}_name`} defaultValue={team[index]?.name ?? ""} maxLength={120} className={inputClass} /></label><label className="text-sm font-medium">{labels.role}<input name={`team_${index + 1}_role`} defaultValue={team[index]?.role ?? ""} maxLength={120} className={inputClass} /></label><label className="text-sm font-medium">{bookingCopy[locale].account}<select name={`team_${index + 1}_staff_id`} defaultValue={team[index]?.booking_staff_id ?? ""} className={inputClass}><option value="">{bookingCopy[locale].displayOnly}</option>{(staff ?? []).map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label></div>)}</div>
          </section>

          <section className={sectionClass}>
            <h2 className="flex items-center gap-2 text-xl font-semibold"><ShieldCheck className="size-5 text-[#a56d37]" />{labels.payments}</h2>
            <div className="mt-4 flex flex-wrap gap-3">{[["card", labels.card], ["cash", labels.cash], ["deposit", labels.deposit], ["mixed", labels.mixed]].map(([value, label]) => <label key={value} className="flex items-center gap-2 rounded-full border border-[#dfd2c1] px-4 py-2 text-sm"><input type="checkbox" name="payment_methods" value={value} defaultChecked={payments.includes(value)} className="accent-[#a56d37]" />{label}</label>)}</div>
            <h3 className="mt-6 text-lg font-semibold">{labels.policies}</h3>
            <div className="mt-4 grid gap-4">{(["fr", "en", "es"] as const).map((language, index) => <label key={language} className="text-sm font-medium">{labels.locales[index]}<textarea name={`policies_${language}`} defaultValue={policies[language] ?? ""} rows={3} maxLength={1000} className={`${inputClass} h-auto py-3`} /></label>)}</div>
          </section>

          <input type="hidden" name="publication_action" defaultValue={profile?.is_published ? "publish" : "private"} />
          <div className="sticky bottom-4 grid gap-3 rounded-2xl border border-[#dfd2c1] bg-white/95 p-3 shadow-xl backdrop-blur dark:border-white/15 dark:bg-[#17191e]/95 sm:grid-cols-2">
            <button type="submit" name="publication_action" value="private" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#cdbba6] bg-white px-6 text-sm font-semibold text-slate-950 hover:bg-[#faf5ed] dark:border-white/20 dark:bg-white/5 dark:text-stone-100 dark:hover:bg-white/10"><Save className="size-4" />{labels.savePrivate}</button>
            <button type="submit" name="publication_action" value="publish" className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950"><ExternalLink className="size-4" />{labels.savePublish}</button>
          </div>
        </DirectUploadProfileForm>
      </div>
    </main>
  );
}
