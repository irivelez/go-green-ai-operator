"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Send,
  RefreshCw,
  Sparkles,
  Bot,
  User as UserIcon,
  AlertTriangle,
  Loader2,
  Camera,
  Languages,
} from "lucide-react";
import { newWebLeadId } from "@/src/id";
import type { Decision, OperatorResponse } from "./types";
import { ScoreChip, StageBadge } from "./icons";
import { fmtRange } from "./format";

type Bubble =
  | { id: string; role: "user"; text: string; hasPhoto?: boolean }
  | { id: string; role: "operator"; text: string; decision: Decision; lead_id: string };

interface Sample {
  label: string;
  text: string;
  hasPhoto?: boolean;
  flag?: "en" | "es";
}

const SAMPLES: Sample[] = [
  {
    label: "Biweekly · Mission",
    text: "Hi! I'd like biweekly maintenance for 742 Valencia St, San Francisco 94110",
    hasPhoto: true,
    flag: "en",
  },
  {
    label: "HOA weekly · Pacific Heights",
    text: "Our HOA needs weekly service for the common areas at 1200 Gough St 94109",
    flag: "en",
  },
  {
    label: "Monthly · Daly City",
    text: "monthly service for 120 Hillside Blvd, Daly City 94015",
    flag: "en",
  },
  {
    label: "Quincenal · Castro (ES)",
    text: "Hola, necesito mantenimiento quincenal para 4127 18th St, San Francisco 94114",
    hasPhoto: true,
    flag: "es",
  },
];

export function OperatorConsole({ onAfterSend }: { onAfterSend: () => void | Promise<void> }) {
  const [leadId, setLeadId] = useState<string>("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Generate a stable lead_id on mount
  useEffect(() => {
    setLeadId(newWebLeadId());
  }, []);

  // Auto-scroll to bottom on new bubbles
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [bubbles, sending]);

  const reset = useCallback(() => {
    setBubbles([]);
    setDraft("");
    setError(null);
    setLeadId(newWebLeadId());
  }, []);

  const send = useCallback(
    async (text: string, opts?: { hasPhoto?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setBubbles((prev) => [...prev, { id: `u-${id}`, role: "user", text: trimmed, hasPhoto: opts?.hasPhoto }]);
      setDraft("");
      setSending(true);
      setError(null);
      try {
        const res = await fetch("/api/operator", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lead_id: leadId,
            channel: "form",
            text: trimmed,
            has_photo: opts?.hasPhoto ?? false,
          }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 120)}` : ""}`);
        }
        const data = (await res.json()) as OperatorResponse;
        setBubbles((prev) => [
          ...prev,
          {
            id: `a-${id}`,
            role: "operator",
            text: data.reply,
            decision: data.decision,
            lead_id: data.lead.lead_id,
          },
        ]);
        // Re-fetch leads in parent so KPIs/board update live
        await onAfterSend();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Send failed");
      } finally {
        setSending(false);
      }
    },
    [leadId, sending, onAfterSend],
  );

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send(draft);
  };

  const isEmpty = bubbles.length === 0;

  const shortId = useMemo(() => (leadId ? leadId.slice(-8) : "—"), [leadId]);

  return (
    <section className="rounded-2xl border border-moss-200 bg-white shadow-petal-lg overflow-hidden flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 bg-gradient-to-br from-moss-700 to-moss-800 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-moss-50/15 backdrop-blur-sm border border-moss-50/20">
            <Bot className="h-4 w-4 text-moss-50" strokeWidth={1.9} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg text-moss-50 leading-tight font-medium">Operator Console</h2>
            <p className="text-[11px] text-moss-100/75 mt-0.5 truncate">
              Talk to the agent like a real lead — actions reflect live on the board
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-moss-100/25 bg-moss-50/10 px-2.5 py-1 text-[10px] font-mono text-moss-50/85">
            <span className="h-1.5 w-1.5 rounded-full bg-moss-300 dot-live" />
            {shortId}
          </span>
          <button
            type="button"
            onClick={reset}
            disabled={sending}
            className="inline-flex items-center gap-1.5 rounded-full border border-moss-100/30 bg-moss-50/10 px-2.5 py-1 text-[11px] font-medium text-moss-50 hover:bg-moss-50/20 transition disabled:opacity-50"
            title="Reset conversation (new lead_id)"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={2.2} />
            Reset
          </button>
        </div>
      </header>

      {/* Sample chips */}
      <div className="px-4 py-3 sm:px-5 bg-moss-50/50 border-b border-moss-100">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-moss-700/70 mb-2 font-semibold">
          <Sparkles className="h-3 w-3" strokeWidth={2} />
          Try a sample
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => void send(s.text, { hasPhoto: s.hasPhoto })}
              disabled={sending}
              className="group inline-flex items-center gap-1.5 rounded-full border border-moss-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-moss-800 hover:bg-moss-50 hover:border-moss-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
              title={s.text}
            >
              {s.flag === "es" && <Languages className="h-3 w-3 text-moss-500" strokeWidth={2} />}
              <span>{s.label}</span>
              {s.hasPhoto && <Camera className="h-3 w-3 text-moss-500 opacity-70" strokeWidth={2} />}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div
        ref={scrollerRef}
        className="flex-1 min-h-[280px] max-h-[560px] overflow-y-auto rail bg-paper px-4 py-5 sm:px-5"
      >
        {isEmpty && !sending && <EmptyState />}

        <div className="space-y-4">
          {bubbles.map((b) =>
            b.role === "user" ? (
              <UserBubble key={b.id} text={b.text} hasPhoto={b.hasPhoto} />
            ) : (
              <OperatorBubble key={b.id} text={b.text} decision={b.decision} leadId={b.lead_id} />
            ),
          )}
          {sending && <ThinkingBubble />}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 sm:px-5 py-2 bg-amber-50 border-t border-amber-200 text-[12px] text-amber-900 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Composer */}
      <form onSubmit={submit} className="flex items-end gap-2 border-t border-moss-100 bg-white px-3 py-3 sm:px-4">
        <div className="flex-1 rounded-xl border border-moss-200 bg-moss-50/40 px-3 py-2 focus-within:border-moss-400 focus-within:bg-white transition">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            placeholder="Type as a lead — address, frequency, language, anything…"
            disabled={sending}
            className="w-full resize-none bg-transparent text-sm text-bark-900 placeholder:text-moss-700/40 focus:outline-none leading-snug max-h-32"
          />
        </div>
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-moss-700 px-4 text-sm font-semibold text-moss-50 transition hover:bg-moss-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-petal"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" strokeWidth={2.2} />}
          Send
        </button>
      </form>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-moss-100 border border-moss-200 text-moss-700 mb-3">
        <Bot className="h-5 w-5" strokeWidth={1.7} />
      </div>
      <h3 className="font-display text-lg text-bark-900">Operator is listening</h3>
      <p className="text-[12px] text-moss-700/65 mt-1 max-w-[32ch] leading-relaxed">
        Send any inbound message — or tap a sample above — and watch the decision trace, pipeline, and KPIs update live.
      </p>
    </div>
  );
}

function UserBubble({ text, hasPhoto }: { text: string; hasPhoto?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 justify-end rise-in">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-moss-700 px-3.5 py-2.5 text-sm text-moss-50 shadow-petal leading-relaxed">
        <p className="whitespace-pre-wrap break-words">{text}</p>
        {hasPhoto && (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-moss-50/15 px-2 py-0.5 text-[10px] font-medium text-moss-100/90">
            <Camera className="h-3 w-3" strokeWidth={2} />
            photo attached
          </div>
        )}
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-200 text-moss-800 mt-0.5">
        <UserIcon className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
    </div>
  );
}

function OperatorBubble({ text, decision, leadId }: { text: string; decision: Decision; leadId: string }) {
  return (
    <div className="flex items-start gap-2.5 rise-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-700 text-moss-50 mt-0.5 shadow-petal">
        <Bot className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
      <div className="max-w-[88%] space-y-2 min-w-0">
        <div className="rounded-2xl rounded-tl-md bg-white border border-moss-100 px-3.5 py-2.5 text-sm text-bark-900 shadow-petal leading-relaxed">
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
        <DecisionTrace decision={decision} leadId={leadId} />
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-start gap-2.5 rise-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-moss-700 text-moss-50 mt-0.5 shadow-petal">
        <Bot className="h-3.5 w-3.5" strokeWidth={2} />
      </div>
      <div className="rounded-2xl rounded-tl-md bg-white border border-moss-100 px-4 py-3 shadow-petal">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-moss-400 animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-moss-400 animate-bounce" style={{ animationDelay: "120ms" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-moss-400 animate-bounce" style={{ animationDelay: "240ms" }} />
        </div>
      </div>
    </div>
  );
}

function DecisionTrace({ decision, leadId }: { decision: Decision; leadId: string }) {
  const range = fmtRange(decision.price_range);
  return (
    <details className="group rounded-xl border border-moss-100 bg-moss-50/50 open:bg-white open:shadow-petal transition-all">
      <summary className="cursor-pointer list-none px-3 py-2 flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-[10px] uppercase tracking-[0.16em] font-semibold text-moss-700/70">Decision</span>
        <span className="opacity-40">·</span>
        <span className="font-medium text-bark-900">{decision.intent}</span>
        <ScoreChip score={decision.score} />
        <StageBadge stage={decision.stage} size="xs" />
        {decision.escalated && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-1.5 h-5 text-[10px] font-semibold">
            <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.4} />
            escalated
          </span>
        )}
        {decision.used_llm && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-1.5 h-5 text-[10px] font-semibold uppercase tracking-wider">
            <Sparkles className="h-2.5 w-2.5" strokeWidth={2.4} />
            llm
          </span>
        )}
        <span className="ml-auto text-[10px] text-moss-700/50 group-open:rotate-180 transition-transform">▾</span>
      </summary>

      <div className="px-3 pb-3 pt-1 space-y-2.5 text-[11px] text-moss-800">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          <Field k="lead_id" v={<span className="font-mono">{leadId.slice(-12)}</span>} />
          <Field k="language" v={decision.language.toUpperCase()} />
          {range && <Field k="price range" v={<span className="font-medium text-moss-900">{range}</span>} />}
          {decision.suggested_package && <Field k="package" v={decision.suggested_package} />}
          {decision.booked_slot && (
            <Field k="booked slot" v={<span className="text-emerald-700 font-medium">{decision.booked_slot}</span>} />
          )}
        </div>

        {decision.slots.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-moss-700/65 mb-1">
              Offered slots
            </div>
            <div className="flex flex-wrap gap-1">
              {decision.slots.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center rounded border border-moss-200 bg-white px-1.5 py-0.5 text-[10px] font-mono text-moss-800"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {decision.missing.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-amber-800/80 mb-1">Missing</div>
            <div className="flex flex-wrap gap-1">
              {decision.missing.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-900"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}

        {decision.escalation_reasons.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-amber-800/80 mb-1">
              Escalation reasons
            </div>
            <ul className="space-y-0.5 text-amber-900">
              {decision.escalation_reasons.map((r, i) => (
                <li key={i} className="text-[11px] leading-relaxed">
                  · {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {decision.trace.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] font-semibold text-moss-700/65 mb-1">Trace</div>
            <ol className="space-y-0.5 font-mono text-[10.5px] text-moss-800/85 leading-relaxed pl-4 list-decimal marker:text-moss-400">
              {decision.trace.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </details>
  );
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-moss-700/55 font-semibold shrink-0">{k}</span>
      <span className="text-[11px] truncate">{v}</span>
    </div>
  );
}
