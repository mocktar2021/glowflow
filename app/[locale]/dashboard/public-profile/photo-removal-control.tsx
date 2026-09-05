"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  inputName: "remove_cover" | "remove_gallery_urls";
  inputValue?: string;
  removeLabel: string;
  undoLabel: string;
  pendingLabel: string;
  className?: string;
};

export function PhotoRemovalControl({
  children,
  inputName,
  inputValue,
  removeLabel,
  undoLabel,
  pendingLabel,
  className = "",
}: Props) {
  const [marked, setMarked] = useState(false);

  return (
    <div
      className={`${className} transition ${marked ? "border-rose-300 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-950/20" : ""}`}
    >
      <div className={marked ? "opacity-35 grayscale" : ""}>{children}</div>
      <input
        type="checkbox"
        name={inputName}
        value={inputValue}
        checked={marked}
        readOnly
        className="sr-only"
        tabIndex={-1}
      />
      <button
        type="button"
        aria-pressed={marked}
        onClick={() => setMarked((current) => !current)}
        className={`mt-2 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${marked ? "bg-slate-950 text-white dark:bg-stone-100 dark:text-slate-950" : "border border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300"}`}
      >
        {marked ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />}
        {marked ? undoLabel : removeLabel}
      </button>
      {marked ? <p role="status" className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300">{pendingLabel}</p> : null}
    </div>
  );
}
