"use client";

import { useCallback, useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";

const MAX_PHOTOS = 6;
const MAX_BYTES = 10 * 1024 * 1024;

export function PhotoUploader({
  photos,
  onChange,
  t,
}: {
  photos: string[]; // data-URL strings
  onChange: (next: string[]) => void;
  t: Dict;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tt = t.funnel.photos;

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files) return;
      const remaining = MAX_PHOTOS - photos.length;
      if (remaining <= 0) return;
      const arr = Array.from(files).slice(0, remaining);
      const next: string[] = [];
      for (const f of arr) {
        if (f.size > MAX_BYTES) continue;
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(f);
        });
        if (dataUrl) next.push(dataUrl);
      }
      onChange([...photos, ...next]);
    },
    [photos, onChange],
  );

  const removeAt = useCallback(
    (i: number) => {
      onChange(photos.filter((_, j) => j !== i));
    },
    [photos, onChange],
  );

  const remaining = MAX_PHOTOS - photos.length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map((src, i) => (
          <div
            key={`${i}-${src.slice(-12)}`}
            className="relative aspect-[4/3] rounded-2xl overflow-hidden border border-moss-100 bg-moss-50 shadow-petal group"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`Photo ${i + 1}`}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={tt.removePhoto}
              className="absolute top-2 right-2 inline-flex items-center justify-center h-7 w-7 rounded-full bg-white/90 border border-moss-100 shadow-petal opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
            >
              <X className="h-3.5 w-3.5 text-bark-900" />
            </button>
          </div>
        ))}

        {photos.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="aspect-[4/3] rounded-2xl border-2 border-dashed border-moss-200 hover:border-moss-400 bg-paper transition flex flex-col items-center justify-center gap-2 text-moss-700 hover:text-moss-800 group"
          >
            <ImagePlus
              className="h-7 w-7 text-moss-500 group-hover:text-moss-700 transition"
              strokeWidth={1.6}
            />
            <span className="text-[12px] font-medium">{tt.uploadCta}</span>
            <span className="text-[10px] uppercase tracking-[0.14em] text-moss-600/70">
              {tt.remaining(photos.length)}
            </span>
          </button>
        )}
      </div>
      <p className="text-[11px] text-moss-700/60 leading-relaxed">
        {tt.uploadHint} · {tt.privacyNote}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
        aria-label={tt.uploadCta}
      />
      {remaining === 0 && (
        <p className="text-[11px] text-moss-700/60">{tt.remaining(photos.length)}</p>
      )}
    </div>
  );
}
