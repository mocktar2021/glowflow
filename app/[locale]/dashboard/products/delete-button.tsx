"use client";

export function DeleteButton({ label, confirmation }: { label: string; confirmation: string }) {
  return <button type="submit" onClick={(event) => { if (!window.confirm(confirmation)) event.preventDefault(); }} className="min-h-11 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700">{label}</button>;
}
