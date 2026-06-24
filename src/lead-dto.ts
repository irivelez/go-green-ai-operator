// Serialization-safe client view of the store Lead. Derived from the ONE source
// (store.ts) via Omit, so the dashboard's client types can't silently drift from
// the server shape (the former hand-copied mirror already had — it was missing
// every v2 measurement/pricing field). Excludes only the server-internal /
// sensitive fields a browser must never see: the idempotency ledger, the tenant
// scope key, and the HITL event log.
import type { Lead } from "./store";

export type LeadDTO = Omit<Lead, "_actions" | "owner_id" | "events">;
