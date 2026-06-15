"use client";

import { useState } from "react";
import { ShieldCheck, UserRoundCog } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import type { EscalationFlag } from "@/src/contract";

export function HumanReviewStep({
  escalation,
  initial,
  fallbackAddress,
  onSubmit,
  t,
}: {
  escalation: EscalationFlag;
  initial?: { name?: string; email?: string; phone?: string; address?: string };
  fallbackAddress?: string;
  onSubmit: (values: {
    name: string;
    email: string;
    phone: string;
    address: string;
  }) => void;
  t: Dict;
}) {
  const tt = t.funnel.humanReview;
  const [sent, setSent] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(
    initial?.address ?? fallbackAddress ?? "",
  );

  const canSend =
    name.trim().length >= 2 &&
    /.+@.+\..+/.test(email) &&
    phone.trim().length >= 6 &&
    address.trim().length >= 6;

  if (sent) {
    return (
      <div className="rounded-3xl border border-moss-200 bg-moss-50/60 p-8 text-center shadow-petal-lg max-w-[640px]">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-moss-700 text-moss-50 mb-3">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.8} />
        </div>
        <h2 className="font-display text-2xl text-bark-900">{tt.sentTitle}</h2>
        <p className="mt-2 text-[14px] text-moss-800/85 leading-relaxed">
          {tt.sentSubtitle}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-7 max-w-[680px]">
      <header className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
          <UserRoundCog className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <div className="space-y-1.5">
          <h2 className="font-display text-3xl text-bark-900">{tt.title}</h2>
          <p className="text-[14.5px] text-moss-800/85 leading-relaxed">
            {tt.subtitle}
          </p>
        </div>
      </header>

      <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 space-y-3">
        <h3 className="text-[11px] uppercase tracking-[0.16em] text-amber-900 font-medium">
          {tt.brief}
        </h3>
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2 text-[13px] text-amber-900">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-amber-900/70 font-medium">
              {tt.reasonLabel}
            </span>
            <span className="capitalize">{escalation.primary.replace(/_/g, " ")}</span>
          </div>
          <p className="text-[13px] text-amber-900/85 leading-relaxed">
            {escalation.brief}
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[12px] uppercase tracking-[0.16em] text-moss-700 font-medium">
          {tt.contactTitle}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input value={name} onChange={setName} placeholder={t.funnel.identity.namePlaceholder} />
          <Input
            value={email}
            onChange={setEmail}
            placeholder={t.funnel.identity.emailPlaceholder}
            type="email"
          />
          <Input
            value={phone}
            onChange={setPhone}
            placeholder={t.funnel.identity.phonePlaceholder}
            type="tel"
          />
          <Input
            value={address}
            onChange={setAddress}
            placeholder={t.funnel.identity.addressPlaceholder}
          />
        </div>
      </section>

      <button
        type="button"
        onClick={() => {
          onSubmit({
            name: name.trim(),
            email: email.trim(),
            phone: phone.trim(),
            address: address.trim(),
          });
          setSent(true);
        }}
        disabled={!canSend}
        className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3.5 text-[14.5px] font-medium shadow-petal hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-500 transition"
      >
        {tt.cta}
      </button>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-2xl bg-white border border-moss-100 px-4 py-3 text-[14px] text-bark-900 placeholder:text-moss-700/40 focus:outline-none focus:border-moss-400 focus:ring-2 focus:ring-moss-200/40 shadow-petal"
    />
  );
}
