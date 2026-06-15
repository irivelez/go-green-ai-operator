// MOCK — replaced in S6 (currency/taxes/discounts owned by S1 stream).
// The math here is the REAL math from src/contract.ts. Mock only in API namespace.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  PRICE_BOOK,
  addOnById,
  monthlyFromVisit,
  type Frequency,
  type PricingLineItem,
  type PricingResult,
  type Tier,
} from "@/src/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  tier: z.enum(["essential", "signature", "estate"]),
  frequency: z.enum(["weekly", "biweekly", "monthly"]),
  addOnIds: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const tier = parsed.data.tier as Tier;
  const frequency = parsed.data.frequency as Frequency;
  const ids: string[] = parsed.data.addOnIds;

  const perVisit = PRICE_BOOK[tier].perVisit;
  const monthlyRecurring = monthlyFromVisit(tier, frequency);

  const fixedAddOnLineItems: PricingLineItem[] = [];
  const openEndedFlagged: PricingResult["openEndedFlagged"] = [];

  for (const id of ids) {
    const a = addOnById(id);
    if (!a) continue;
    if (a.kind === "fixed") {
      fixedAddOnLineItems.push({
        addOnId: a.id,
        name: a.name,
        amount: a.priceStartingAt,
        unit: a.unit,
      });
    } else {
      openEndedFlagged.push({
        addOnId: a.id,
        name: a.name,
        reason: a.openEndedReason ?? "Open-ended item — human-quoted.",
      });
    }
  }

  const addOnsTotal = fixedAddOnLineItems.reduce((s, x) => s + x.amount, 0);
  const firstChargeTotal = Math.round((monthlyRecurring + addOnsTotal) * 100) / 100;

  const result: PricingResult = {
    tier,
    frequency,
    perVisit,
    monthlyRecurring,
    fixedAddOnLineItems,
    openEndedFlagged,
    firstChargeTotal,
    recurringMonthly: monthlyRecurring,
    currency: "USD",
    assumptions: [
      "Final price confirmed on-site after the first visit.",
      "Open-ended items quoted separately by a human.",
      "Monthly plan = per-visit × frequency multiplier (weekly 4.33, biweekly 2.17, monthly 1.0).",
    ],
  };

  return NextResponse.json(result);
}
