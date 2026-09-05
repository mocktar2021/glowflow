"use client";

import { ImagePlus, Images } from "lucide-react";
import { useState } from "react";

type Props = {
  hasCover: boolean;
  galleryCount: number;
  labels: {
    cover: string;
    gallery: string;
    addCover: string;
    replaceCover: string;
    addGallery: string;
    remaining: string;
    selected: string;
    tooMany: string;
  };
};

export function PhotoUploadControls({ hasCover, galleryCount, labels }: Props) {
  const [coverName, setCoverName] = useState("");
  const [galleryNames, setGalleryNames] = useState<string[]>([]);
  const remaining = Math.max(0, 8 - galleryCount);

  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-dashed border-[#cfae89] bg-[#fffaf3] p-4 dark:border-[#b77a42]/60 dark:bg-[#b77a42]/10">
        <p className="text-sm font-semibold">{labels.cover}</p>
        <label htmlFor="cover-photo-upload" className="mt-3 inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950">
          <ImagePlus className="size-4" />
          {hasCover ? labels.replaceCover : labels.addCover}
        </label>
        <input
          id="cover-photo-upload"
          name="cover_photo"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          onChange={(event) => setCoverName(event.currentTarget.files?.[0]?.name ?? "")}
        />
        {coverName ? <p role="status" className="mt-3 break-all text-xs font-medium text-slate-600 dark:text-stone-300">{labels.selected}: {coverName}</p> : null}
      </div>

      <div className="rounded-2xl border border-dashed border-[#cfae89] bg-[#fffaf3] p-4 dark:border-[#b77a42]/60 dark:bg-[#b77a42]/10">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold">{labels.gallery}</p>
          <span className="rounded-full bg-[#f1e2cf] px-2.5 py-1 text-xs font-bold text-[#8c5628] dark:bg-white/10 dark:text-[#efc992]">{galleryCount}/8</span>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-stone-400">{remaining} {labels.remaining}</p>
        <label
          htmlFor="gallery-photo-upload"
          aria-disabled={remaining === 0}
          className={`mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${remaining === 0 ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-white/10" : "cursor-pointer bg-slate-950 text-white hover:bg-slate-800 dark:bg-[#e7b779] dark:text-slate-950"}`}
        >
          <Images className="size-4" />
          {labels.addGallery}
        </label>
        <input
          id="gallery-photo-upload"
          name="gallery_photos"
          type="file"
          multiple
          disabled={remaining === 0}
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          onChange={(event) => {
            const input = event.currentTarget;
            const files = Array.from(input.files ?? []);
            if (files.length > remaining) {
              input.setCustomValidity(labels.tooMany.replace("{count}", String(remaining)));
              input.reportValidity();
              input.value = "";
              setGalleryNames([]);
              return;
            }
            input.setCustomValidity("");
            setGalleryNames(files.map((file) => file.name));
          }}
        />
        {galleryNames.length ? (
          <div role="status" className="mt-3 text-xs font-medium text-slate-600 dark:text-stone-300">
            <p>{labels.selected}:</p>
            <ul className="mt-1 space-y-1">{galleryNames.map((name) => <li key={name} className="break-all">• {name}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
