// Serverless Telegram channel (spec §4.2) — the deterministic operator path that runs on
// Vercel (no Agent SDK subprocess needed). Activates when TELEGRAM_BOT_TOKEN is set.
// Same brain as the dashboard's Operator console (src/operator.ts). The full Agent SDK
// runtime (src/agent.ts) is the long-running alternative for hosts that want it.

import { NextRequest, NextResponse } from "next/server";
import { runOperator } from "@/src/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function tg(method: string, body: unknown): Promise<unknown> {
  if (!TOKEN) return null;
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json().catch(() => null);
}

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text: string = msg?.text ?? msg?.caption ?? "";
  const hasPhoto = Array.isArray(msg?.photo) && msg.photo.length > 0;
  if (!chatId || (!text && !hasPhoto)) return NextResponse.json({ ok: true });

  await tg("sendChatAction", { chat_id: chatId, action: "typing" });
  try {
    const res = await runOperator({
      lead_id: `tg-${chatId}`,
      channel: "telegram",
      name: msg.from?.first_name,
      text: text || "(sent a photo)",
      has_photo: hasPhoto,
    });
    await tg("sendMessage", { chat_id: chatId, text: res.reply });
  } catch {
    await tg("sendMessage", { chat_id: chatId, text: "Thank you — one moment while our team reviews this." });
  }
  return NextResponse.json({ ok: true });
}

// Convenience: GET ?setup=1 registers the webhook to this deployment; otherwise returns status.
export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 400 });
  const url = new URL(req.url);
  if (url.searchParams.get("setup") === "1") {
    const hookUrl = `${url.protocol}//${url.host}/api/telegram/webhook`;
    const res = await tg("setWebhook", {
      url: hookUrl,
      allowed_updates: ["message"],
      drop_pending_updates: true,
      ...(process.env.TELEGRAM_WEBHOOK_SECRET ? { secret_token: process.env.TELEGRAM_WEBHOOK_SECRET } : {}),
    });
    return NextResponse.json({ registered_to: hookUrl, telegram: res });
  }
  const info = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`).then((r) => r.json());
  return NextResponse.json(info);
}
