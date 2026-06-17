"use client";

// The chat-first surface. ONE agent drives the whole booking flow: the model streams
// text AND calls tools; each tool result renders as an interactive card (generative UI).
// This replaces the old form-wizard + defanged-sidebar split.

import { useEffect, useId, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message } from "ai";
import { ImagePlus, SendHorizonal, Sparkles, Loader2 } from "lucide-react";
import type { Tier, SlotOffer, PricingResult, VisionAssessment } from "@/src/contract";
import type {
  QualifyResult,
  RecommendTierResult,
  ProposeCheckoutResult,
  ConfirmBookingResult,
  RaiseEscalationResult,
} from "@/src/agent-tools";
import {
  type Lang,
  QualifyCard,
  TierOptionsCard,
  QuoteCard,
  CheckoutCard,
  SlotPickerCard,
  ConfirmationCard,
  EscalationCard,
  TraceChip,
} from "./cards";

const COPY = {
  en: {
    greeting:
      "Hi — I'm your Go Green garden concierge. Tell me what your outdoor space needs and I'll handle the rest: plan, price, and booking. What brings you here?",
    placeholder: "Describe your garden, ask about plans or pricing…",
    addPhotos: "Add yard photos",
    running: "Working on it",
    photosAdded: (n: number) => `I've added ${n} photo${n === 1 ? "" : "s"} of my yard.`,
    chooseTier: (name: string) => `I'd like the ${name} plan.`,
    bookSlot: (when: string, id: string) => `Please book ${when} (slot ${id}).`,
    checking: "Checking your service area",
    analyzing: "Looking at your photos",
    pricing: "Pricing your plan",
    staging: "Preparing secure checkout",
    finding: "Finding open visits",
    booking: "Locking your booking",
    routing: "Connecting you with a specialist",
  },
  es: {
    greeting:
      "Hola — soy tu concierge de jardín de Go Green. Cuéntame qué necesita tu espacio y yo me encargo del resto: plan, precio y reserva. ¿En qué te ayudo?",
    placeholder: "Describe tu jardín, pregunta por planes o precios…",
    addPhotos: "Agregar fotos del jardín",
    running: "Trabajando en ello",
    photosAdded: (n: number) => `Agregué ${n} foto${n === 1 ? "" : "s"} de mi jardín.`,
    chooseTier: (name: string) => `Quiero el plan ${name}.`,
    bookSlot: (when: string, id: string) => `Por favor reserva ${when} (espacio ${id}).`,
    checking: "Verificando tu zona de servicio",
    analyzing: "Revisando tus fotos",
    pricing: "Calculando tu plan",
    staging: "Preparando el pago seguro",
    finding: "Buscando visitas disponibles",
    booking: "Confirmando tu reserva",
    routing: "Conectándote con un especialista",
  },
} satisfies Record<Lang, Record<string, unknown>>;

interface ToolPart {
  toolName: string;
  state: "partial-call" | "call" | "result";
  result?: unknown;
}

function toolPartsOf(m: Message): ToolPart[] {
  const parts = (m as { parts?: Array<{ type: string; toolInvocation?: ToolPart }> }).parts;
  if (parts) {
    return parts
      .filter((p) => p.type === "tool-invocation" && p.toolInvocation)
      .map((p) => p.toolInvocation as ToolPart);
  }
  const legacy = (m as { toolInvocations?: ToolPart[] }).toolInvocations;
  return legacy ?? [];
}

function textOf(m: Message): string {
  const parts = (m as { parts?: Array<{ type: string; text?: string }> }).parts;
  if (parts) {
    // Each text part is one continuous span; when a tool call splits the turn we
    // get several. Join with a paragraph break so pre/post-tool narration reads
    // naturally instead of running two sentences together.
    return parts
      .filter((p) => p.type === "text")
      .map((p) => (p.text ?? "").trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return typeof m.content === "string" ? m.content : "";
}

export function GenerativeChat({ language }: { language: Lang }) {
  const reactId = useId();
  const leadIdRef = useRef<string>(`web-${reactId.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now().toString(36)}`);
  const [photos, setPhotos] = useState<string[]>([]);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const c = COPY[language];

  const { messages, input, handleInputChange, handleSubmit, append, status, error } = useChat({
    id: `agent-${language}`,
    api: "/api/funnel/agent",
  });

  const body = () => ({ leadId: leadIdRef.current, language, photos });
  const isBusy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const send = (text: string) => {
    if (!text.trim()) return;
    void append({ role: "user", content: text }, { body: body() });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isBusy) return;
    handleSubmit(e, { body: body() });
  };

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const read = (f: File) =>
      new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
    const urls = await Promise.all(Array.from(files).slice(0, 6).map(read));
    const next = [...photos, ...urls].slice(0, 6);
    setPhotos(next);
    void append({ role: "user", content: c.photosAdded(next.length) }, { body: { leadId: leadIdRef.current, language, photos: next } });
  };

  const runningLabel = (name: string): string => {
    switch (name) {
      case "qualify_lead": return c.checking;
      case "analyze_photos": return c.analyzing;
      case "compute_pricing": return c.pricing;
      case "propose_checkout": return c.staging;
      case "offer_slots": return c.finding;
      case "confirm_booking": return c.booking;
      case "raise_escalation": return c.routing;
      default: return c.running;
    }
  };

  const renderTool = (tp: ToolPart, key: string) => {
    if (tp.state !== "result") {
      return (
        <div key={key} className="rise-in inline-flex items-center gap-2 rounded-full border border-moss-100 bg-paper/60 px-3 py-1.5 text-[12px] text-moss-700/80">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          {runningLabel(tp.toolName)}…
        </div>
      );
    }
    const res = tp.result;
    switch (tp.toolName) {
      case "qualify_lead":
        return <QualifyCard key={key} lang={language} r={res as QualifyResult} />;
      case "analyze_photos": {
        const v = res as VisionAssessment;
        return (
          <TraceChip
            key={key}
            lang={language}
            lines={[
              `slope ${v.slope_signals?.steepness_hint ?? "unknown"} · condition ${v.condition_score}/10`,
              `cleanup ${v.cleanup_required ? "recommended" : "not needed"}`,
              `suggested tier: ${v.recommended_tier}`,
              `confidence ${(v.confidence * 100).toFixed(0)}%`,
            ]}
          />
        );
      }
      case "recommend_tier":
        return (
          <TierOptionsCard
            key={key}
            lang={language}
            r={res as RecommendTierResult}
            onChoose={(tier: Tier) => {
              const name = (res as RecommendTierResult).options.find((o) => o.tier === tier)?.name ?? tier;
              send(c.chooseTier(name));
            }}
          />
        );
      case "compute_pricing": {
        const p = res as PricingResult | { error: string };
        if ("error" in p) return null;
        return <QuoteCard key={key} lang={language} p={p} />;
      }
      case "propose_checkout":
        return <CheckoutCard key={key} lang={language} r={res as ProposeCheckoutResult} />;
      case "offer_slots":
        return (
          <SlotPickerCard
            key={key}
            lang={language}
            slots={res as SlotOffer[]}
            onPick={(s: SlotOffer) => {
              const when = `${s.date} ${s.startTime.slice(11, 16)}`;
              send(c.bookSlot(when, s.slotId));
            }}
          />
        );
      case "confirm_booking":
        return <ConfirmationCard key={key} lang={language} r={res as ConfirmBookingResult} />;
      case "raise_escalation":
        return <EscalationCard key={key} lang={language} r={res as RaiseEscalationResult} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6">
        {messages.length === 0 && (
          <div className="rise-in flex items-start gap-2.5">
            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-100 text-moss-700">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <div className="max-w-[80%] rounded-2xl rounded-bl-md border border-moss-100 bg-white px-4 py-3 text-[14px] leading-relaxed text-bark-900 shadow-petal">
              {c.greeting}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === "user";
          const text = textOf(m);
          const tools = toolPartsOf(m);
          return (
            <div key={m.id} className="space-y-2.5">
              {text && (
                <div className={isUser ? "flex justify-end" : "flex items-start gap-2.5"}>
                  {!isUser && (
                    <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-100 text-moss-700">
                      <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                    </span>
                  )}
                  <div
                    className={[
                      "max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-3 text-[14px] leading-relaxed shadow-petal",
                      isUser
                        ? "rounded-br-md bg-moss-700 text-moss-50"
                        : "rounded-bl-md border border-moss-100 bg-white text-bark-900",
                    ].join(" ")}
                  >
                    {text}
                  </div>
                </div>
              )}
              {tools.length > 0 && (
                <div className="space-y-2.5 pl-9">
                  {tools.map((tp, i) => renderTool(tp, `${m.id}-t${i}`))}
                </div>
              )}
            </div>
          );
        })}

        {isBusy && messages[messages.length - 1]?.role === "user" && (
          <div className="rise-in flex items-center gap-2 pl-9 text-[12px] text-moss-700/70">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            {c.running}…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
            {error.message}
          </div>
        )}
      </div>

      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto border-t border-moss-100 bg-paper/40 px-4 py-2 sm:px-6">
          {photos.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p} alt={`yard ${i + 1}`} className="h-12 w-12 shrink-0 rounded-lg border border-moss-200 object-cover" />
          ))}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-moss-100 bg-white px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-moss-200 text-moss-700 transition hover:bg-moss-50"
          aria-label={c.addPhotos}
          title={c.addPhotos}
        >
          <ImagePlus className="h-4.5 w-4.5" strokeWidth={2} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <textarea
          value={input}
          onChange={handleInputChange}
          rows={1}
          placeholder={c.placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
            }
          }}
          className="max-h-32 flex-1 resize-none rounded-2xl border border-moss-100 bg-paper px-4 py-2.5 text-[14px] leading-snug text-bark-900 placeholder:text-moss-700/40 focus:border-moss-400 focus:outline-none focus:ring-2 focus:ring-moss-200/40"
        />
        <button
          type="submit"
          disabled={!input.trim() || isBusy}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-moss-700 text-moss-50 shadow-petal transition hover:bg-moss-800 disabled:bg-moss-200 disabled:text-moss-400"
          aria-label="Send"
        >
          <SendHorizonal className="h-4 w-4" strokeWidth={2} />
        </button>
      </form>
    </div>
  );
}
