"use client";

import type { Lang } from "../state";

export function LanguageSwitcher({
  lang,
  onChange,
  labels,
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
  labels: { en: string; es: string };
}) {
  const Btn = ({ l, label }: { l: Lang; label: string }) => {
    const active = l === lang;
    return (
      <button
        type="button"
        onClick={() => onChange(l)}
        aria-pressed={active}
        className={[
          "px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] font-medium rounded-full transition",
          active
            ? "bg-moss-700 text-moss-50 shadow-petal"
            : "text-moss-700/70 hover:text-moss-800",
        ].join(" ")}
      >
        {label}
      </button>
    );
  };

  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full border border-moss-200 bg-white/80 backdrop-blur-sm">
      <Btn l="en" label={labels.en} />
      <Btn l="es" label={labels.es} />
    </div>
  );
}
