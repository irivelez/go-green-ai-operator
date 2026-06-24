import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signSession, passwordMatches, SESSION_COOKIE } from "@/src/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LoginSchema = z.object({ password: z.string().min(1).max(200) }).strict();

export async function POST(req: NextRequest) {
  const ownerPassword = process.env.OWNER_PASSWORD;
  const secret = process.env.OWNER_SESSION_SECRET;
  if (!ownerPassword || !secret) {
    return NextResponse.json(
      { ok: false, error: "owner auth not configured (OWNER_PASSWORD / OWNER_SESSION_SECRET)" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  }

  if (!passwordMatches(parsed.data.password, ownerPassword)) {
    return NextResponse.json({ ok: false, error: "invalid password" }, { status: 401 });
  }

  const token = await signSession(secret);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
