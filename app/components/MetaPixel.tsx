"use client";

// Client-only Meta Pixel for the customer funnel (V1 — no server-side CAPI).
//
// Mount this ONLY on customer surfaces (`/agent`, `/funnel/success`). NEVER on the
// owner dashboard (`/`) or `/login` — those are operator surfaces and must not
// emit marketing events for the business.
//
// The init script is rendered only when `NEXT_PUBLIC_META_PIXEL_ID` is set, so
// zero-key dev + tests stay green. Without the env var the component renders
// nothing and `window.fbq` is undefined; `trackPixel()` becomes a guarded no-op.

import Script from "next/script";

// Minimal typing for the Meta Pixel function. We only ever call it with
// ("init", id) | ("track", event) | ("track", event, params). The queue/loaded
// properties match the inline bootstrap snippet below so TypeScript doesn't
// reject the assignment shape.
type FbqArgs =
  | [event: "init", pixelId: string]
  | [event: "track" | "trackCustom", name: string]
  | [event: "track" | "trackCustom", name: string, params: Record<string, unknown>];

interface Fbq {
  (...args: FbqArgs): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
  push?: Fbq;
}

declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export type MetaPixelEvent = "PageView" | "InitiateCheckout" | "Purchase";

export type MetaPixelParams = Record<string, string | number>;

/**
 * Safe wrapper around `window.fbq`. No-op when the pixel script has not loaded
 * (no env id, SSR, or the script hasn't injected yet). Every fbq call in the
 * app MUST go through this helper.
 */
export function trackPixel(event: MetaPixelEvent, params?: MetaPixelParams): void {
  if (typeof window === "undefined") return;
  const fbq = window.fbq;
  if (typeof fbq !== "function") return;
  if (params && Object.keys(params).length > 0) {
    fbq("track", event, params);
  } else {
    fbq("track", event);
  }
}

/**
 * Renders the standard Meta Pixel init snippet (afterInteractive). Returns null
 * when `NEXT_PUBLIC_META_PIXEL_ID` is unset so the customer surface still works
 * in zero-key dev and CI. The pixel id is JSON-stringified to neutralize any
 * stray quote in the env value.
 */
export function MetaPixel() {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (!pixelId) return null;
  const init =
    "!function(f,b,e,v,n,t,s)" +
    "{if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
    "n.callMethod.apply(n,arguments):n.queue.push(arguments)};" +
    "if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';" +
    "n.queue=[];t=b.createElement(e);t.async=!0;" +
    "t.src=v;s=b.getElementsByTagName(e)[0];" +
    "s.parentNode.insertBefore(t,s)}(window,document,'script'," +
    "'https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init',${JSON.stringify(pixelId)});` +
    "fbq('track','PageView');";
  return (
    <Script
      id="meta-pixel-init"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: init }}
    />
  );
}
