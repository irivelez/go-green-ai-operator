// ChatPanel — side panel on desktop, bottom sheet on mobile.
// Uses Vercel AI SDK v4 ('@ai-sdk/react' v1.2.x) `useChat`. The route at
// /api/funnel/agent emits AI SDK Data Stream protocol (text parts encoded as
// `0:"..."\n`), so we leave the default streamProtocol ("data") in place.
// Reasoning for pin: react@19 + next@15 → ai@^4 + @ai-sdk/react@^1 is the
// stable matrix at install time.

"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { MessageSquareText, X, SendHorizonal, Sparkles } from "lucide-react";
import type { Dict } from "@/lib/i18n/en";
import type { FunnelStateLocal } from "../state";

export function ChatPanel({
  t,
  funnelState,
}: {
  t: Dict;
  funnelState: FunnelStateLocal;
}) {
  const [openOnMobile, setOpenOnMobile] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // We re-instantiate when language changes so the assistant mirrors mid-flow.
  const { messages, input, handleInputChange, handleSubmit, status } = useChat({
    id: `funnel-${funnelState.language}`,
    api: "/api/funnel/agent",
    streamProtocol: "data",
    body: {
      funnelState: {
        language: funnelState.language,
        step: funnelState.step,
      },
    },
  });

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const tt = t.funnel.chat;
  const isStreaming = status === "submitted" || status === "streaming";

  const Body = (
    <div className="flex flex-col h-full bg-paper">
      <header className="flex items-center justify-between gap-3 border-b border-moss-100 bg-white/80 backdrop-blur-sm px-4 py-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-moss-100 text-moss-700">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-medium text-bark-900">{tt.title}</div>
            <div className="text-[11px] text-moss-700/70">{tt.subtitle}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpenOnMobile(false)}
          className="lg:hidden text-moss-700 hover:text-bark-900 p-1 -m-1"
          aria-label={tt.closeCta}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-[13px] text-moss-800/80 leading-relaxed rounded-2xl border border-moss-100 bg-white p-3 shadow-petal">
            {tt.emptyStateGreeting}
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === "user";
          const text =
            // Prefer parts[].text for v4 streaming output.
            m.parts
              ?.filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("") ||
            m.content ||
            "";
          return (
            <div
              key={m.id}
              className={[
                "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
                isUser
                  ? "ml-auto bg-moss-700 text-moss-50 rounded-br-md shadow-petal"
                  : "bg-white text-bark-900 border border-moss-100 rounded-bl-md shadow-petal",
              ].join(" ")}
            >
              {text}
            </div>
          );
        })}
        {isStreaming && (
          <div className="max-w-[60%] rounded-2xl px-3 py-2 text-[12px] text-moss-700/70 bg-white border border-moss-100 inline-flex items-center gap-2">
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-moss-400 animate-pulse" />
              <span
                className="h-1.5 w-1.5 rounded-full bg-moss-400 animate-pulse"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-moss-400 animate-pulse"
                style={{ animationDelay: "300ms" }}
              />
            </span>
            <span>{tt.sending}</span>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-moss-100 bg-white p-3 flex items-end gap-2"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          rows={1}
          placeholder={tt.placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim().length > 0) {
                (e.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
              }
            }
          }}
          className="flex-1 resize-none rounded-2xl bg-paper border border-moss-100 px-3.5 py-2.5 text-[13px] text-bark-900 placeholder:text-moss-700/40 focus:outline-none focus:border-moss-400 focus:ring-2 focus:ring-moss-200/40 leading-snug max-h-32"
        />
        <button
          type="submit"
          disabled={input.trim().length === 0 || isStreaming}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-moss-700 text-moss-50 disabled:bg-moss-200 disabled:text-moss-400 transition shadow-petal"
          aria-label={tt.placeholder}
        >
          <SendHorizonal className="h-4 w-4" strokeWidth={2} />
        </button>
      </form>
    </div>
  );

  return (
    <>
      {/* Desktop side panel */}
      <aside className="hidden lg:flex flex-col h-[640px] sticky top-6 w-full rounded-3xl border border-moss-100 bg-white shadow-petal-lg overflow-hidden">
        {Body}
      </aside>

      {/* Mobile sticky pill */}
      <button
        type="button"
        onClick={() => setOpenOnMobile(true)}
        className="lg:hidden fixed bottom-4 right-4 z-30 inline-flex items-center gap-2 rounded-full bg-moss-700 text-moss-50 px-4 py-2.5 shadow-petal-lg"
      >
        <MessageSquareText className="h-4 w-4" strokeWidth={2} />
        <span className="text-[12.5px] font-medium">{tt.openCta}</span>
      </button>

      {/* Mobile bottom sheet */}
      {openOnMobile && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-bark-900/30 backdrop-blur-sm"
            onClick={() => setOpenOnMobile(false)}
          />
          <div className="absolute inset-x-0 bottom-0 h-[78vh] bg-paper rounded-t-3xl border-t border-moss-100 shadow-petal-lg overflow-hidden rise-in">
            {Body}
          </div>
        </div>
      )}
    </>
  );
}
