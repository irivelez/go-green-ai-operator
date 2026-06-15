"use client";

import { useState } from "react";
import { ArrowLeft, Lock, ShieldCheck } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import type { Frequency, PricingResult, Tier } from "@/src/contract";
import type { IdentityValues } from "./IdentityStep";

export function CheckoutStep({
  tier,
  frequency,
  pricing,
  identity,
  selectedFixed,
  selectedOpenEnded,
  onBack,
  onSuccess,
  t,
}: {
  tier: Tier;
  frequency: Frequency;
  pricing: PricingResult;
  identity: IdentityValues;
  selectedFixed: string[];
  selectedOpenEnded: string[];
  onBack: () => void;
  onSuccess: () => void;
  t: Dict;
}) {
  const tt = t.funnel.checkout;
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simulate() {
    setProcessing(true);
    setError(null);
    try {
      const res = await fetch("/api/funnel/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier,
          frequency,
          addOnIds: [...selectedFixed, ...selectedOpenEnded],
          customer: identity,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        url?: string;
        stripeUrl?: string;
        mock?: boolean;
      };
      // stripeUrl present = real hosted checkout (hard redirect); else mock (advance locally).
      if (data.stripeUrl) {
        window.location.href = data.stripeUrl;
        return;
      }
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t.common.error);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-7 max-w-[640px]">
      <header className="space-y-2">
        <h2 className="font-display text-3xl text-bark-900">{tt.title}</h2>
        <p className="text-[14.5px] text-moss-800/85 leading-relaxed">{tt.subtitle}</p>
      </header>

      <div className="rounded-3xl border border-moss-100 bg-white shadow-petal-lg overflow-hidden">
        <div className="px-5 sm:px-6 py-5 bg-paper/40 border-b border-moss-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-moss-100 text-moss-700">
              <Lock className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="leading-tight">
              <div className="text-[11px] uppercase tracking-[0.16em] text-moss-700 font-medium">
                Stripe
              </div>
              <div className="text-[12.5px] text-moss-700/70">
                {processing ? tt.processing : "Test mode"}
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-900 font-medium">
            {tt.mockBadge}
          </span>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-3">
          <Row
            label={t.funnel.quote.dueToday}
            value={`$${pricing.firstChargeTotal.toFixed(2)}`}
            big
          />
          <Row
            label={t.funnel.quote.renewsMonthly}
            value={`$${pricing.recurringMonthly.toFixed(2)} / mo`}
            muted
          />
          <div className="hairline my-2" />
          <Row label={t.funnel.identity.emailLabel} value={identity.email} mono />
          <Row label={t.funnel.identity.addressLabel} value={identity.address} mono />
        </div>

        <div className="px-5 sm:px-6 py-5 border-t border-moss-100 bg-white space-y-3">
          <button
            type="button"
            onClick={simulate}
            disabled={processing}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3.5 text-[14.5px] font-medium shadow-petal hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-500 transition"
          >
            {processing ? tt.processing : tt.simulateCta}
          </button>
          <button
            type="button"
            onClick={onBack}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-[13px] text-moss-700 hover:text-bark-900 hover:bg-moss-50 transition"
          >
            <ArrowLeft className="h-4 w-4" />
            {tt.cancelCta}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-moss-100 bg-moss-50/60 p-4 flex gap-3">
        <ShieldCheck
          className="h-5 w-5 text-moss-700 mt-0.5 shrink-0"
          strokeWidth={1.8}
        />
        <p className="text-[12.5px] text-moss-900/85 leading-relaxed">
          {t.funnel.quote.guarantee}
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          {error}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  big,
  muted,
  mono,
}: {
  label: string;
  value: string;
  big?: boolean;
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-[0.16em] text-moss-700 font-medium">
        {label}
      </span>
      <span
        className={[
          big
            ? "font-display text-2xl text-bark-900 font-medium"
            : "text-[13.5px] text-bark-900",
          muted ? "text-moss-700/75" : "",
          mono ? "font-mono text-[12px]" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}
