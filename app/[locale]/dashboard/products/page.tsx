import { randomUUID } from "node:crypto";

import { ArrowLeft, PackagePlus } from "lucide-react";
import { cookies } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LanguageSwitcher } from "@/components/glowflow/language-switcher";
import { requireUser } from "@/lib/auth";
import { isLocale, type Locale } from "@/lib/i18n";
import { localizedProductText, productDefaultLocale } from "@/lib/product-localization";
import { deleteProduct, saveProduct } from "./actions";
import { DeleteButton } from "./delete-button";
import { ProductForm } from "./product-form";

export const dynamic = "force-dynamic";

type Product = {
  id: string;
  name_json: Record<string, string>;
  description_json: Record<string, string>;
  image_alt_json: Record<string, string>;
  category: string;
  image_url: string | null;
  price: number;
  currency: string;
  stock_visibility: string;
  is_published: boolean;
};

const copy = {
  fr: { title: "Catalogue de produits", subtitle: "Présentez les produits du salon. La vente en ligne n’est pas disponible.", back: "Tableau de bord", add: "Ajouter un produit", current: "Produits du salon", empty: "Aucun produit pour le moment.", name: "Nom", description: "Description", imageAlt: "Texte alternatif de l’image", french: "Français", english: "Anglais", spanish: "Espagnol", category: "Catégorie", hair: "Cheveux", nails: "Ongles", skincare: "Soins de la peau", accessories: "Accessoires", other: "Autres", price: "Prix", currency: "Devise", stock: "Visibilité du stock", available: "Disponible", unavailable: "Indisponible", notShown: "Ne pas afficher", image: "Photo du produit", replace: "Ajouter ou remplacer la photo", removeImage: "Retirer la photo", mediaHelp: "JPG, PNG, WebP ou AVIF ; 1 Mo maximum. Décrivez toute photo dans les trois langues.", draft: "Privé", published: "Publié", savePrivate: "Enregistrer en privé", savePublish: "Enregistrer et publier", delete: "Supprimer définitivement", confirmDelete: "Supprimer définitivement ce produit ?", saved: "Produit enregistré.", deleted: "Produit supprimé.", error: "La modification a échoué. Vérifiez les champs et réessayez.", invalidImage: "Choisissez une image JPG, PNG, WebP ou AVIF de 1 Mo maximum.", uploadFailed: "L’envoi ou l’enregistrement a échoué.", altRequired: "Décrivez l’image en français, anglais et espagnol.", saving: "Envoi et enregistrement…" },
  en: { title: "Product catalog", subtitle: "Showcase salon products. Online purchasing is not available.", back: "Dashboard", add: "Add a product", current: "Salon products", empty: "No products yet.", name: "Name", description: "Description", imageAlt: "Image alternative text", french: "French", english: "English", spanish: "Spanish", category: "Category", hair: "Hair", nails: "Nails", skincare: "Skincare", accessories: "Accessories", other: "Other", price: "Price", currency: "Currency", stock: "Stock visibility", available: "Available", unavailable: "Unavailable", notShown: "Do not show", image: "Product photo", replace: "Add or replace photo", removeImage: "Remove photo", mediaHelp: "JPG, PNG, WebP, or AVIF; 1 MB maximum. Describe any photo in all three languages.", draft: "Private", published: "Published", savePrivate: "Save privately", savePublish: "Save and publish", delete: "Delete permanently", confirmDelete: "Permanently delete this product?", saved: "Product saved.", deleted: "Product deleted.", error: "The change failed. Review the fields and try again.", invalidImage: "Choose a JPG, PNG, WebP, or AVIF image up to 1 MB.", uploadFailed: "Upload or save failed.", altRequired: "Describe the image in French, English, and Spanish.", saving: "Uploading and saving…" },
  es: { title: "Catálogo de productos", subtitle: "Muestra los productos del salón. La compra en línea no está disponible.", back: "Panel", add: "Añadir un producto", current: "Productos del salón", empty: "Aún no hay productos.", name: "Nombre", description: "Descripción", imageAlt: "Texto alternativo de la imagen", french: "Francés", english: "Inglés", spanish: "Español", category: "Categoría", hair: "Cabello", nails: "Uñas", skincare: "Cuidado de la piel", accessories: "Accesorios", other: "Otros", price: "Precio", currency: "Moneda", stock: "Visibilidad del stock", available: "Disponible", unavailable: "No disponible", notShown: "No mostrar", image: "Foto del producto", replace: "Añadir o reemplazar la foto", removeImage: "Quitar la foto", mediaHelp: "JPG, PNG, WebP o AVIF; máximo 1 MB. Describe cada foto en los tres idiomas.", draft: "Privado", published: "Publicado", savePrivate: "Guardar en privado", savePublish: "Guardar y publicar", delete: "Eliminar definitivamente", confirmDelete: "¿Eliminar definitivamente este producto?", saved: "Producto guardado.", deleted: "Producto eliminado.", error: "No se pudo guardar. Revisa los campos e inténtalo de nuevo.", invalidImage: "Elige una imagen JPG, PNG, WebP o AVIF de hasta 1 MB.", uploadFailed: "Falló la carga o el guardado.", altRequired: "Describe la imagen en francés, inglés y español.", saving: "Cargando y guardando…" },
} as const;

const inputClass = "mt-2 min-h-11 w-full rounded-xl border border-[#dfd2c1] bg-[#fffdf9] px-3 py-2 text-slate-950 outline-none focus:border-[#b77a42] dark:border-white/15 dark:bg-[#22252b] dark:text-white";
const cardClass = "rounded-[1.75rem] border border-[#e4d6c5] bg-white p-5 dark:border-white/10 dark:bg-[#17191e] sm:p-7";

const hints = {
  fr: { oneName: "Saisissez un nom dans une seule langue. Les traductions sont facultatives.", alt: "Pour une photo, décrivez-la dans au moins une langue.", nameRequired: "Saisissez un nom de produit dans au moins une langue.", countryLanguage: "Langue du pays", imageFormat: "JPG, PNG, WebP ou AVIF ; 1 Mo maximum." },
  en: { oneName: "Enter a name in any one language. Translations are optional.", alt: "For a photo, add alternative text in at least one language.", nameRequired: "Enter a product name in at least one language.", countryLanguage: "Country language", imageFormat: "JPG, PNG, WebP, or AVIF; 1 MB maximum." },
  es: { oneName: "Escribe un nombre en cualquier idioma. Las traducciones son opcionales.", alt: "Para una foto, añade texto alternativo en al menos un idioma.", nameRequired: "Escribe un nombre de producto en al menos un idioma.", countryLanguage: "Idioma del país", imageFormat: "JPG, PNG, WebP o AVIF; máximo 1 MB." },
} as const;

function Fields({ labels, product, currency, locale, defaultLocale }: { labels: typeof copy.fr | typeof copy.en | typeof copy.es; product?: Product; currency: string; locale: Locale; defaultLocale: Locale }) {
  const languages = [["fr", labels.french], ["en", labels.english], ["es", labels.spanish]] as const;
  return <div className="mt-5 space-y-5">
    <p className="text-sm text-slate-600 dark:text-stone-300">{hints[locale].oneName} {hints[locale].countryLanguage}: {languages.find(([language]) => language === defaultLocale)?.[1]}.</p>
    <div className="grid gap-4 sm:grid-cols-3">{languages.map(([language, label]) => <label key={language} className="text-sm font-medium">{labels.name} ({label})<input name={`name_${language}`} maxLength={120} defaultValue={product?.name_json[language] ?? ""} className={inputClass} /></label>)}</div>
    <div className="grid gap-4 sm:grid-cols-3">{languages.map(([language, label]) => <label key={language} className="text-sm font-medium">{labels.description} ({label})<textarea name={`description_${language}`} maxLength={1200} rows={3} defaultValue={product?.description_json[language] ?? ""} className={inputClass} /></label>)}</div>
    <div className="grid gap-4 sm:grid-cols-3">{languages.map(([language, label]) => <label key={language} className="text-sm font-medium">{labels.imageAlt} ({label})<input name={`alt_${language}`} maxLength={180} defaultValue={product?.image_alt_json[language] ?? ""} className={inputClass} /></label>)}</div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm font-medium">{labels.category}<select name="category" defaultValue={product?.category ?? "hair"} className={inputClass}>{[["hair", labels.hair], ["nails", labels.nails], ["skincare", labels.skincare], ["accessories", labels.accessories], ["other", labels.other]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-medium">{labels.price}<input required name="price" inputMode="decimal" defaultValue={((product?.price ?? 0) / 100).toFixed(2)} className={inputClass} /></label>
      <label className="text-sm font-medium">{labels.currency}<select name="currency" defaultValue={product?.currency ?? currency} className={inputClass}><option value="EUR">EUR</option><option value="USD">USD</option></select></label>
      <label className="text-sm font-medium">{labels.stock}<select name="stock_visibility" defaultValue={product?.stock_visibility ?? "not_shown"} className={inputClass}><option value="not_shown">{labels.notShown}</option><option value="available">{labels.available}</option><option value="unavailable">{labels.unavailable}</option></select></label>
    </div>
    <div className="rounded-2xl border border-[#e4d6c5] p-4 dark:border-white/10">
      <p className="text-sm font-semibold">{labels.image}</p>
      {product?.image_url ? <div className="relative mt-3 h-32 w-32 overflow-hidden rounded-xl"><Image src={product.image_url} alt={localizedProductText(product.image_alt_json, locale, defaultLocale) || localizedProductText(product.name_json, locale, defaultLocale)} fill sizes="128px" className="object-cover" /></div> : null}
      <label className="mt-3 block text-sm font-medium">{labels.replace}<input type="file" name="product_image" accept="image/jpeg,image/png,image/webp,image/avif" className="mt-2 block w-full text-sm" /></label>
      {product?.image_url ? <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="remove_image" />{labels.removeImage}</label> : null}
      <p className="mt-2 text-xs text-slate-500">{hints[locale].imageFormat} {hints[locale].alt}</p>
    </div>
  </div>;
}

function Editor({ locale, labels, tenantId, currency, defaultLocale, product }: {
  locale: Locale; labels: typeof copy.fr | typeof copy.en | typeof copy.es; tenantId: string; currency: string; defaultLocale: Locale; product?: Product;
}) {
  const productId = product?.id ?? randomUUID();
  return <article className={cardClass}>
    <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">{product ? localizedProductText(product.name_json, locale, defaultLocale) : labels.add}</h3>{product ? <span className="rounded-full bg-[#f4ecdf] px-3 py-1 text-xs font-semibold text-[#784822]">{product.is_published ? labels.published : labels.draft}</span> : null}</div>
    <ProductForm action={saveProduct.bind(null, locale)} tenantId={tenantId} productId={productId} messages={{ invalidImage: labels.invalidImage, uploadFailed: labels.uploadFailed, saveFailed: labels.error, saving: labels.saving, altRequired: hints[locale].alt, nameRequired: hints[locale].nameRequired }}>
      <input type="hidden" name="product_id" value={productId} />
      <Fields labels={labels} product={product} currency={currency} locale={locale} defaultLocale={defaultLocale} />
      <div className="mt-5 flex flex-wrap gap-3"><button type="submit" name="publication_action" value="private" className="min-h-11 rounded-xl border border-[#cdbba6] px-4 text-sm font-semibold">{labels.savePrivate}</button><button type="submit" name="publication_action" value="publish" className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white dark:bg-[#e8bb82] dark:text-slate-950">{labels.savePublish}</button></div>
    </ProductForm>
    {product ? <form action={deleteProduct.bind(null, locale)} className="mt-3"><input type="hidden" name="product_id" value={product.id} /><DeleteButton label={labels.delete} confirmation={labels.confirmDelete} /></form> : null}
  </article>;
}

export default async function ProductsPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; deleted?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const labels = copy[locale];
  const { supabase, userId } = await requireUser(locale);
  const { data: owner } = await supabase.from("users").select("tenant_id, role").eq("id", userId).single();
  if (!owner?.tenant_id || owner.role !== "owner") notFound();
  const [{ data: rawProducts, error: productError }, { data: tenant }] = await Promise.all([
    supabase.from("salon_products").select("id,name_json,description_json,image_alt_json,category,image_url,price,currency,stock_visibility,is_published").eq("tenant_id", owner.tenant_id).order("created_at", { ascending: false }),
    supabase.from("tenants").select("currency,country_code").eq("id", owner.tenant_id).single(),
  ]);
  if (productError || !tenant) throw new Error("Unable to load product catalog.");
  const [{ data: market }, cookieStore] = await Promise.all([
    supabase.from("markets").select("default_locale").eq("country_code", tenant.country_code).single(),
    cookies(),
  ]);
  const defaultLocale = productDefaultLocale(market?.default_locale);
  const chosenLocale = cookieStore.get("glowflow_locale")?.value;
  const editorLocale = isLocale(chosenLocale ?? "") ? chosenLocale as Locale : defaultLocale;
  if (locale !== editorLocale) redirect(`/${editorLocale}/dashboard/products`);
  const products = (rawProducts ?? []) as Product[];
  return <main className="min-h-screen bg-[#faf9f6] px-4 py-8 text-slate-950 dark:bg-[#101216] dark:text-stone-100 sm:px-6 lg:px-8"><div className="mx-auto max-w-5xl">
    <div className="flex items-center justify-between gap-4"><Link href={`/${locale}/dashboard`} className="inline-flex items-center gap-2 text-sm font-semibold text-[#9a602d]"><ArrowLeft className="size-4" />{labels.back}</Link><LanguageSwitcher locale={locale} /></div>
    <div className="mt-4 flex items-start gap-3"><PackagePlus className="size-9 text-[#a56d37]" /><div><h1 className="text-3xl font-semibold">{labels.title}</h1><p className="mt-2 text-slate-600 dark:text-stone-300">{labels.subtitle}</p></div></div>
    {query.saved ? <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{labels.saved}</p> : null}
    {query.deleted ? <p role="status" className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{labels.deleted}</p> : null}
    {query.error ? <p role="alert" className="mt-5 rounded-xl bg-rose-50 p-4 text-sm font-semibold text-rose-800">{labels.error}</p> : null}
    <section className="mt-6"><Editor locale={locale} labels={labels} tenantId={owner.tenant_id} currency={tenant.currency} defaultLocale={defaultLocale} /></section>
    <section className="mt-8"><h2 className="text-xl font-semibold">{labels.current}</h2><div className="mt-4 grid gap-5">{products.length ? products.map((product) => <Editor key={product.id} locale={locale} labels={labels} tenantId={owner.tenant_id} currency={tenant.currency} defaultLocale={defaultLocale} product={product} />) : <p className="rounded-2xl border border-dashed border-[#d9c7b2] p-6 text-slate-500">{labels.empty}</p>}</div></section>
  </div></main>;
}
