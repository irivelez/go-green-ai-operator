"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { CircleCheck, Leaf } from "lucide-react";
import { MetaPixel, trackPixel } from "@/app/components/MetaPixel";

export default function SuccessPage() {
  const firedPurchase = useRef(false);

  useEffect(() => {
    if (firedPurchase.current) return;
    if (typeof window === "undefined") return;
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) return;
    firedPurchase.current = true;
    const id = window.setTimeout(() => trackPixel("Purchase", { currency: "USD" }), 0);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <main className="flex min-h-screen flex-col bg-moss-mesh">
      <MetaPixel />
      <header className="flex items-center gap-2.5 px-5 py-4 sm:px-8">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-petal">
          <Leaf className="h-4.5 w-4.5 text-moss-600" strokeWidth={2} />
        </span>
        <div className="leading-tight">
          <div className="text-[10px] uppercase tracking-[0.18em] text-moss-700/70">
            Go Green Landscape
          </div>
          <div className="font-display text-[15px] italic text-bark-900">
            Premium garden care · San Francisco
          </div>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-2xl flex-1 items-center justify-center px-4 pb-10 sm:px-6">
        <div className="w-full rounded-3xl border border-moss-100 bg-paper p-8 shadow-petal-lg sm:p-10">
          <div className="flex flex-col items-center gap-5 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-moss-100 text-moss-700">
              <CircleCheck className="h-7 w-7" strokeWidth={2} />
            </span>
            <div className="space-y-2">
              <h1 className="font-display text-[26px] leading-tight text-bark-900 sm:text-[30px]">
                You&rsquo;re <span className="italic text-moss-700">booked</span>.
              </h1>
              <p className="text-[14.5px] leading-relaxed text-moss-800/85">
                Payment received. A confirmation is on its way, and a Go Green
                specialist will reach out shortly to lock your first visit.
              </p>
            </div>
            <div className="mt-2 w-full rounded-2xl border border-moss-100 bg-white px-4 py-3 text-left text-[12.5px] leading-relaxed text-moss-800/80">
              Final per-visit pricing is confirmed on-site after the first visit.
              The number you saw on the quote is what we&rsquo;ll bill monthly until
              you tell us otherwise.
            </div>
            <Link
              href="/agent"
              className="mt-2 inline-flex items-center justify-center rounded-full border border-moss-200 bg-white px-4 py-2 text-[13px] font-medium text-moss-800 shadow-petal transition hover:bg-moss-50"
            >
              Back to the concierge
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
