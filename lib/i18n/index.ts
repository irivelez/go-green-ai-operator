// Typed i18n helper for the Go Green funnel.
// Stateless: language source-of-truth is the URL ?lang=, with a navigator.language
// fallback the first time the funnel mounts.

"use client";

import { useCallback, useEffect, useState } from "react";
import { en, type Dict } from "./en";
import { es } from "./es";

export type Lang = "en" | "es";

const DICTS: Record<Lang, Dict> = { en, es };

export function getDict(lang: Lang): Dict {
  return DICTS[lang];
}

// Detect a sensible default from the browser (only used when the URL is silent).
function browserDefault(): Lang {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language || "en";
  return lang.toLowerCase().startsWith("es") ? "es" : "en";
}

function readLangFromUrl(): Lang | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const v = params.get("lang");
  return v === "es" || v === "en" ? v : null;
}

function writeLangToUrl(lang: Lang) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("lang", lang);
  window.history.replaceState({}, "", url.toString());
}

/**
 * useLang — URL ?lang= takes precedence, else browser default ("en"|"es").
 * Returned setter rewrites the URL (no localStorage / cookies).
 */
export function useLang(): [Lang, (lang: Lang) => void] {
  // Start neutral; finalize on mount to avoid hydration mismatch.
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const fromUrl = readLangFromUrl();
    const next = fromUrl ?? browserDefault();
    setLangState(next);
    if (!fromUrl) writeLangToUrl(next);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeLangToUrl(next);
  }, []);

  return [lang, setLang];
}

/**
 * useT — convenience hook that pairs the current language with its dict.
 */
export function useT(): { lang: Lang; setLang: (l: Lang) => void; t: Dict } {
  const [lang, setLang] = useLang();
  return { lang, setLang, t: DICTS[lang] };
}

/**
 * t() — function form for non-hook callers (e.g. server-rendered fragments).
 * Pass the language explicitly to keep it pure.
 */
export function t(lang: Lang): Dict {
  return DICTS[lang];
}
