# AGENT SURFACE KNOWLEDGE

## OVERVIEW
`/agent` is the primary customer-facing booking experience. One chat agent calls server tools; each tool result renders as a React card, and deterministic code re-derives every number server-side.

## STRUCTURE
| File | Purpose |
|------|---------|
| `page.tsx` | Route shell and language selection entry. |
| `components/GenerativeChat.tsx` | `useChat`, photo upload, generated lead id, tool-card dispatch. |
| `components/cards.tsx` | Quote, checkout, slots, confirmation, escalation, trace, address, exact-price cards. |
| `components/AreaConfirmCard.tsx` | Google Maps satellite/drawing UI for customer-confirmed area. |

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/render a tool result | `components/GenerativeChat.tsx` | Extend `runningLabel` and `renderTool`. |
| Change card visuals | `components/cards.tsx` | Keep compact operational styling. |
| Change map/redraw UX | `components/AreaConfirmCard.tsx` | Server still owns authoritative area. |
| Change agent API contract | `app/api/funnel/agent/route.ts`, `src/agent-tools.ts` | Update UI only after server shape is settled. |

## CONVENTIONS
- `leadIdRef` uses `crypto.randomUUID()` because route paths are unauthenticated and tenant isolation is a known gap.
- The chat body sends `{ leadId, language, photos }`; tools persist facts through server routes/store.
- Tool cards render `tp.state === "result"` only; in-flight states use small status chips.
- Customer polygon confirmation posts to `/api/funnel/confirm-area`; the chat message after that is only consent/flow text.
- Use local `COPY` objects for EN/ES strings in this surface and keep tone premium, direct, and non-pushy.

## ANTI-PATTERNS
- Do not compute authoritative sqft or price in the browser.
- Do not put raw polygon paths into the LLM conversation.
- Do not show final-price guarantees; exact per-visit numbers are still framed as on-site-review subject to confirmation.
- Do not fabricate Stripe/payment or booking success states in the UI.
- Do not add layout that shifts when tool cards stream in; keep card dimensions and text wrapping stable.

## TESTS
- `src/cards-smoke.test.ts` covers basic card render/type safety only.
- Tool behavior is covered in `tsx src/agent-tools.test.ts`.
- Route production guard is covered in `tsx src/agent-route.test.ts`.
- Manual QA is required for map drawing, photo upload, and streaming chat behavior.
