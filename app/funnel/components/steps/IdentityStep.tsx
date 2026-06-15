"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Mail, MapPin, Phone, User } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";

export interface IdentityValues {
  name: string;
  email: string;
  phone: string;
  address: string;
}

export function IdentityStep({
  initial,
  fallbackAddress,
  onBack,
  onNext,
  t,
}: {
  initial?: Partial<IdentityValues>;
  fallbackAddress?: string;
  onBack: () => void;
  onNext: (values: IdentityValues) => void;
  t: Dict;
}) {
  const tt = t.funnel.identity;
  const [name, setName] = useState(initial?.name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? fallbackAddress ?? "");

  const validEmail = /.+@.+\..+/.test(email);
  const canContinue =
    name.trim().length >= 2 &&
    validEmail &&
    phone.trim().length >= 6 &&
    address.trim().length >= 6;

  return (
    <div className="space-y-7 max-w-[640px]">
      <header className="space-y-2">
        <h2 className="font-display text-3xl text-bark-900">{tt.title}</h2>
        <p className="text-[14.5px] text-moss-800/85 leading-relaxed">{tt.subtitle}</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          icon={<User className="h-4 w-4 text-moss-600" />}
          label={tt.nameLabel}
          placeholder={tt.namePlaceholder}
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        <Field
          icon={<Mail className="h-4 w-4 text-moss-600" />}
          label={tt.emailLabel}
          placeholder={tt.emailPlaceholder}
          value={email}
          onChange={setEmail}
          type="email"
          autoComplete="email"
        />
        <Field
          icon={<Phone className="h-4 w-4 text-moss-600" />}
          label={tt.phoneLabel}
          placeholder={tt.phonePlaceholder}
          value={phone}
          onChange={setPhone}
          type="tel"
          autoComplete="tel"
        />
        <Field
          icon={<MapPin className="h-4 w-4 text-moss-600" />}
          label={tt.addressLabel}
          placeholder={tt.addressPlaceholder}
          value={address}
          onChange={setAddress}
          autoComplete="street-address"
          required
          requiredHint={tt.addressRequired}
        />
      </div>

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
          disabled={!canContinue}
          onClick={() =>
            onNext({
              name: name.trim(),
              email: email.trim(),
              phone: phone.trim(),
              address: address.trim(),
            })
          }
          className="inline-flex items-center gap-2 rounded-full bg-moss-700 text-moss-50 px-6 py-3 text-[14px] font-medium shadow-petal hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-500 transition"
        >
          {tt.cta}
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

function Field({
  icon,
  label,
  placeholder,
  value,
  onChange,
  type = "text",
  autoComplete,
  required,
  requiredHint,
}: {
  icon: React.ReactNode;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  requiredHint?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] uppercase tracking-[0.16em] text-moss-700 font-medium">
        {label}
        {required && <span className="ml-1 text-amber-700">*</span>}
      </span>
      <span className="relative block">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
          {icon}
        </span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full rounded-2xl bg-white border border-moss-100 pl-11 pr-4 py-3 text-[14px] text-bark-900 placeholder:text-moss-700/40 focus:outline-none focus:border-moss-400 focus:ring-2 focus:ring-moss-200/40 shadow-petal"
        />
      </span>
      {required && requiredHint && (
        <span className="block text-[10.5px] text-moss-700/55">{requiredHint}</span>
      )}
    </label>
  );
}
