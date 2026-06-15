"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import type { VisionAssessment } from "@/src/contract";
import { PhotoUploader } from "../PhotoUploader";

export function SpacePhotosStep({
  initialAddress,
  initialPhotos,
  devMock,
  onBack,
  onNext,
  t,
}: {
  initialAddress?: string;
  initialPhotos: string[];
  devMock?: "low-confidence" | "neglected" | "no-slots" | null;
  onBack: () => void;
  onNext: (input: {
    address: string;
    photos: string[];
    assessment: VisionAssessment;
  }) => void;
  t: Dict;
}) {
  const tt = t.funnel.photos;
  const [address, setAddress] = useState(initialAddress ?? "");
  const [photos, setPhotos] = useState<string[]>(initialPhotos);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = address.trim().length >= 6 && photos.length >= 1 && !loading;

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const url =
        devMock === "low-confidence" || devMock === "neglected"
          ? `/api/funnel/vision?mock=${devMock}`
          : "/api/funnel/vision";
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photos }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const assessment = (await res.json()) as VisionAssessment;
      onNext({ address: address.trim(), photos, assessment });
    } catch (e) {
      setError(e instanceof Error ? e.message : tt.analysisError);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-7 max-w-[760px]">
      <header className="space-y-2">
        <h2 className="font-display text-3xl text-bark-900">{tt.title}</h2>
        <p className="text-[14.5px] text-moss-800/85 leading-relaxed">{tt.subtitle}</p>
      </header>

      <section className="space-y-2">
        <label className="block text-[12px] uppercase tracking-[0.16em] text-moss-700 font-medium">
          {tt.addressLabel}
        </label>
        <div className="relative">
          <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-moss-600" />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={tt.addressPlaceholder}
            className="w-full rounded-2xl bg-white border border-moss-100 pl-11 pr-5 py-3.5 text-[14.5px] text-bark-900 placeholder:text-moss-700/40 focus:outline-none focus:border-moss-400 focus:ring-2 focus:ring-moss-200/40 shadow-petal"
            autoComplete="street-address"
          />
        </div>
        <p className="text-[11.5px] text-moss-700/60">{tt.addressHint}</p>
      </section>

      <section className="space-y-3">
        <h3 className="text-[12px] uppercase tracking-[0.16em] text-moss-700 font-medium">
          {tt.uploadCta}
        </h3>
        <PhotoUploader photos={photos} onChange={setPhotos} t={t} />
      </section>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] text-moss-700 hover:text-bark-900 hover:bg-moss-50 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.common.back}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canContinue}
          className="inline-flex items-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3 text-[14px] font-medium shadow-petal hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-500 transition"
        >
          {loading ? tt.analyzing : tt.cta}
          {!loading && <ArrowRight className="h-4 w-4" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}
