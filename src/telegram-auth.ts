// Telegram webhook auth decision (cross-model review S11).
//
// Fail CLOSED: the old `if (secret && presented !== secret)` check skipped auth
// entirely when TELEGRAM_WEBHOOK_SECRET was unset — so a deployment with a live
// TELEGRAM_BOT_TOKEN but no secret accepted ANY POST and let it drive runOperator
// (writing tg-* leads). When a bot token is configured the secret is MANDATORY:
// missing secret config OR a mismatch both reject. With no token the route is
// inert, so an unconfigured local/dev deploy stays usable.

export interface TelegramAuthInput {
  token: string | undefined;
  expectedSecret: string | undefined;
  presentedSecret: string | null;
}

export type TelegramAuthResult =
  | { ok: true }
  | { ok: false; reason: "secret_not_configured" | "secret_mismatch" };

export function telegramWebhookAuth(input: TelegramAuthInput): TelegramAuthResult {
  if (!input.token) return { ok: true };
  if (!input.expectedSecret) return { ok: false, reason: "secret_not_configured" };
  if (input.presentedSecret !== input.expectedSecret) {
    return { ok: false, reason: "secret_mismatch" };
  }
  return { ok: true };
}
