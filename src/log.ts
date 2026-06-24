// Structured logs + daily cost alarm (todo 11 — Metis SC1).
//
// logEvent emits ONE JSON line to stdout (Vercel log drain). NO Datadog/OTel —
// structured stdout is the whole observability stack for V1. Never log full PII
// or photo payloads.
//
// The cost alarm increments an Upstash counter `cost:daily:{date}` per model call
// and fires ONE Telegram alert per day when the day's total crosses
// DAILY_COST_ALARM_USD. The "alert once per day" dedup is a SET NX EX key
// (`cost:alarmed:{date}`) so a cron re-check doesn't spam the owner.

import { getSharedRedis } from "./store";

export interface LogFields {
  ts?: string;
  leadId?: string;
  action: string;
  status?: string;
  latency_ms?: number;
  tokens?: number;
  cost_usd?: number;
  provider_event_id?: string;
  error?: string;
}

export function logEvent(fields: LogFields): void {
  const line = { ts: fields.ts ?? new Date().toISOString(), ...fields };
  console.log(JSON.stringify(line));
}

const DAY = () => new Date().toISOString().slice(0, 10);
const COST_KEY = (day: string) => `cost:daily:${day}`;
const ALARMED_KEY = (day: string) => `cost:alarmed:${day}`;
const COST_TTL_SECONDS = 36 * 60 * 60;

// In-process counters for dev (no Upstash).
let memCostMicro = 0;
let memCostDay = DAY();
const memAlarmed = new Set<string>();

export function resetCostMeter(): void {
  memCostMicro = 0;
  memCostDay = DAY();
  memAlarmed.clear();
}

// Add model-call USD to today's running total (micro-dollar integer precision).
// Returns the running total in USD.
export async function addDailyCost(usd: number): Promise<number> {
  const day = DAY();
  const micro = Math.max(0, Math.round(usd * 1_000_000));
  const redis = getSharedRedis();
  if (redis) {
    const total = await redis.incrby(COST_KEY(day), micro);
    await redis.expire(COST_KEY(day), COST_TTL_SECONDS);
    return total / 1_000_000;
  }
  if (memCostDay !== day) {
    memCostDay = day;
    memCostMicro = 0;
  }
  memCostMicro += micro;
  return memCostMicro / 1_000_000;
}

export interface CostAlarmResult {
  total_usd: number;
  threshold_usd: number;
  fired: boolean;
}

// Check today's cost vs DAILY_COST_ALARM_USD and fire ONE Telegram alert per day
// (deduped via SET NX). Safe to call from the drain cron each tick. No env / no
// Upstash → no-op (dev/zero-key stays green).
export async function checkCostAlarm(): Promise<CostAlarmResult> {
  const threshold = Number(process.env.DAILY_COST_ALARM_USD ?? 0);
  const day = DAY();
  const total = await readDailyCost(day);
  const result: CostAlarmResult = { total_usd: total, threshold_usd: threshold, fired: false };
  if (threshold <= 0 || total < threshold) return result;

  if (!(await claimAlarmOncePerDay(day))) return result;
  await sendTelegramAlert(
    `Go Green cost alarm: today's estimated LLM spend $${total.toFixed(2)} crossed $${threshold.toFixed(2)}.`,
  );
  result.fired = true;
  return result;
}

async function readDailyCost(day: string): Promise<number> {
  const redis = getSharedRedis();
  if (redis) {
    const micro = (await redis.get<number>(COST_KEY(day))) ?? 0;
    return Number(micro) / 1_000_000;
  }
  return memCostDay === day ? memCostMicro / 1_000_000 : 0;
}

// Returns true exactly once per day (the caller that wins the SET NX).
async function claimAlarmOncePerDay(day: string): Promise<boolean> {
  const redis = getSharedRedis();
  if (redis) {
    const won = await redis.set(ALARMED_KEY(day), "1", { nx: true, ex: COST_TTL_SECONDS });
    return won === "OK";
  }
  if (memAlarmed.has(day)) return false;
  memAlarmed.add(day);
  return true;
}

async function sendTelegramAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_OWNER_CHAT_ID;
  if (!token || !chatId) return; // unconfigured → no-op (the JSON log still records it)
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("[log] cost-alarm Telegram send failed:", (e as Error).message);
  }
}
