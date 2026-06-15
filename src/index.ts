// Entrypoint — Telegram live channel → agent (spec §4.2). STAGED: needs TELEGRAM_BOT_TOKEN + key.
// The channel adapter normalizes inbound to one internal shape so swapping to WhatsApp is config.

import TelegramBot from "node-telegram-bot-api";
import { runLead } from "./agent";
import { upsertLead } from "./store";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN missing — set it in .env to go live. Core logic still runs via `npm run test:core`.");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log("Go Green AI Operator — Telegram channel live.");

bot.on("message", async (m) => {
  const lead_id = `tg-${m.chat.id}`;
  const text = m.text ?? m.caption ?? "";
  const photos = m.photo ? [m.photo[m.photo.length - 1]!.file_id] : [];

  upsertLead({ lead_id, channel: "telegram", name: m.from?.first_name, photos });

  const res = await runLead({ lead_id, channel: "telegram", inbound_text: text, photo_urls: photos });
  const reply = res && "result" in res && typeof res.result === "string"
    ? res.result
    : "Thanks — one moment while our team reviews this.";
  await bot.sendMessage(m.chat.id, reply);
});
