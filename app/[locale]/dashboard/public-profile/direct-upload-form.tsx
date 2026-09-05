"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { createClient } from "@/lib/supabase/client";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const maximumImageBytes = 1024 * 1024;

type Props = {
  action: (formData: FormData) => Promise<{ saved: true }>;
  children: ReactNode;
  tenantId: string;
  messages: {
    invalidImage: string;
    uploadFailed: string;
    publishIncomplete: string;
    saving: string;
  };
};

function extension(file: File) {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  };
  return byType[file.type] ?? "bin";
}

export function DirectUploadProfileForm({ action, children, tenantId, messages }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const publish = formData.get("is_published") === "on";
    if (
      publish
      && (
        formData.getAll("categories").length === 0
        || formData.getAll("payment_methods").length === 0
        || ["fr", "en", "es"].some((locale) => !String(formData.get(`description_${locale}`) ?? "").trim())
      )
    ) {
      setError(messages.publishIncomplete);
      return;
    }

    const cover = formData.get("cover_photo");
    const gallery = formData.getAll("gallery_photos").filter((item): item is File => item instanceof File && item.size > 0);
    const files = [
      ...(cover instanceof File && cover.size > 0 ? [cover] : []),
      ...gallery,
    ];

    if (files.some((file) => !allowedImageTypes.has(file.type) || file.size > maximumImageBytes)) {
      setError(messages.invalidImage);
      return;
    }

    formData.delete("cover_photo");
    formData.delete("gallery_photos");

    startTransition(async () => {
      const supabase = createClient();
      const uploadedPaths: string[] = [];
      try {
        const upload = async (file: File) => {
          const path = `${tenantId}/${crypto.randomUUID()}.${extension(file)}`;
          const { error: uploadError } = await supabase.storage.from("salon-public-media").upload(path, file, {
            cacheControl: "31536000",
            contentType: file.type,
            upsert: false,
          });
          if (uploadError) throw uploadError;
          uploadedPaths.push(path);
          return supabase.storage.from("salon-public-media").getPublicUrl(path).data.publicUrl;
        };

        if (cover instanceof File && cover.size > 0) {
          formData.set("uploaded_cover_url", await upload(cover));
        }
        for (const photo of gallery) {
          formData.append("uploaded_gallery_urls", await upload(photo));
        }

        const result = await action(formData);
        if (result.saved) {
          window.location.assign(`${window.location.pathname}?saved=1`);
        }
      } catch {
        if (uploadedPaths.length) {
          await supabase.storage.from("salon-public-media").remove(uploadedPaths);
        }
        setError(messages.uploadFailed);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-5" aria-busy={pending}>
      {error ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
          {error}
        </p>
      ) : null}
      {pending ? (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {messages.saving}
        </p>
      ) : null}
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
