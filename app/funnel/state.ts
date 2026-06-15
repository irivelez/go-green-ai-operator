// Shared funnel state container — held in app/funnel/page.tsx and threaded
// to step components via props. The state shape mirrors FunnelState in
// src/contract.ts and adds dev-only escape-hatch flags.

import type {
  EscalationFlag,
  Frequency,
  FunnelStep,
  PricingResult,
  Tier,
  VisionAssessment,
} from "@/src/contract";

// Re-export so the page can keep imports tight.
export type {
  EscalationFlag,
  Frequency,
  FunnelStep,
  PricingResult,
  Tier,
  VisionAssessment,
};

export type Lang = "en" | "es";

// Local sentinel: `app/funnel/state` re-uses `FunnelState` from contract.ts but
// adds the dev escape-hatch flags so the S0 slice can demo every surface.
export interface FunnelStateLocal {
  step: FunnelStep;
  language: Lang;
  intent?: string;
  address?: string;
  photos: string[];
  visionAssessment?: VisionAssessment;
  recommendedTier?: Tier;
  confirmedTier?: Tier;
  selectedAddOns: string[];
  selectedOpenEndedAddOns: string[]; // human-quote-only ids — not chargeable
  frequency?: Frequency;
  identity?: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  pricingResult?: PricingResult;
  selectedSlotId?: string;
  escalation?: EscalationFlag;
  devMock?: "low-confidence" | "neglected" | "no-slots" | null;
}

export const INITIAL_STATE: FunnelStateLocal = {
  step: "intent",
  language: "en",
  photos: [],
  selectedAddOns: [],
  selectedOpenEndedAddOns: [],
};

export const PROGRESS_STEPS: FunnelStep[] = [
  "intent",
  "space_photos",
  "tier_recommend",
  "identity",
  "quote",
  "checkout",
  "schedule",
  "confirmed",
];

export function progressIndex(step: FunnelStep): number {
  const i = PROGRESS_STEPS.indexOf(step);
  return i === -1 ? 0 : i;
}
