// 122-bit entropy mitigates the unauthenticated leads routes (AGENTS.md §1).
export function newWebLeadId(): string {
  return `web-${crypto.randomUUID()}`;
}
