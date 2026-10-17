"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { createClient } from "@/lib/supabase/client";

const allowedTypes: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif",
};
const maxImageBytes = 1024 * 1024;

export function ProductForm({ action, children, tenantId, productId, messages }: {
  action: (formData: FormData) => Promise<{ saved: boolean; error?: string }>;
  children: ReactNode;
  tenantId: string;
  productId: string;
  messages: { invalidImage: string; uploadFailed: string; saveFailed: string; saving: string; altRequired: string };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name) formData.set(submitter.name, submitter.value);
    const image = formData.get("product_image");
    const file = image instanceof File && image.size > 0 ? image : null;
    if (file && (!allowedTypes[file.type] || file.size > maxImageBytes)) {
      setError(messages.invalidImage);
      return;
    }
    if (file && ["fr", "en", "es"].some((locale) => !String(formData.get(`alt_${locale}`) ?? "").trim())) {
      setError(messages.altRequired);
      return;
    }
    formData.delete("product_image");

    startTransition(async () => {
      const supabase = createClient();
      let uploadedPath: string | null = null;
      let actionStarted = false;
      try {
        if (file) {
          uploadedPath = `${tenantId}/products/${productId}/${crypto.randomUUID()}.${allowedTypes[file.type]}`;
          const { error: uploadError } = await supabase.storage.from("salon-public-media").upload(uploadedPath, file, {
            cacheControl: "31536000", contentType: file.type, upsert: false,
          });
          if (uploadError) throw uploadError;
          formData.set("uploaded_image_url", supabase.storage.from("salon-public-media").getPublicUrl(uploadedPath).data.publicUrl);
        }
        actionStarted = true;
        const result = await action(formData);
        if (!result.saved) {
          if (uploadedPath) await supabase.storage.from("salon-public-media").remove([uploadedPath]);
          setError(result.error === "image_alt_required" ? messages.altRequired : messages.saveFailed);
          return;
        }
        window.location.assign(`${window.location.pathname}?saved=1`);
      } catch {
        // A transport failure after the action starts leaves commit status unknown.
        // Keep the uploaded image rather than breaking a possibly saved product.
        if (uploadedPath && !actionStarted) await supabase.storage.from("salon-public-media").remove([uploadedPath]);
        setError(messages.uploadFailed);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending}>
      {error ? <p role="alert" className="my-4 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-800">{error}</p> : null}
      {pending ? <p role="status" className="my-4 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900">{messages.saving}</p> : null}
      <fieldset disabled={pending} className="contents">{children}</fieldset>
    </form>
  );
}
