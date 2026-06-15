"use client";

import { useCallback, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  CLEANUP_GATING_ADDON_ID,
  type EscalationFlag,
  type Frequency,
  type FunnelStep,
  type PricingResult,
  type Tier,
  type VisionAssessment,
} from "@/src/contract";
import {
  INITIAL_STATE,
  type FunnelStateLocal,
  type Lang,
} from "./state";
import { FunnelShell } from "./components/FunnelShell";
import { ChatPanel } from "./components/ChatPanel";
import { IntentStep } from "./components/steps/IntentStep";
import { SpacePhotosStep } from "./components/steps/SpacePhotosStep";
import { TierRecommendStep } from "./components/steps/TierRecommendStep";
import { IdentityStep, type IdentityValues } from "./components/steps/IdentityStep";
import { QuoteStep } from "./components/steps/QuoteStep";
import { CheckoutStep } from "./components/steps/CheckoutStep";
import { ScheduleStep } from "./components/steps/ScheduleStep";
import { ConfirmedStep } from "./components/steps/ConfirmedStep";
import { HumanReviewStep } from "./components/steps/HumanReviewStep";

const LOW_VISION_CONFIDENCE = 0.5;

function escalationFromVision(a: VisionAssessment): EscalationFlag | null {
  if (a.confidence < LOW_VISION_CONFIDENCE) {
    return {
      flags: ["low_vision_confidence"],
      primary: "low_vision_confidence",
      brief: `Vision confidence ${a.confidence.toFixed(
        2,
      )} is below ${LOW_VISION_CONFIDENCE}. Photos were unclear or non-yard. A human should review the photos and follow up.`,
      autoChargeBlocked: true,
    };
  }
  return null;
}

function readDemoMock(): FunnelStateLocal["devMock"] {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("demo");
  return v === "neglected" || v === "low-confidence" || v === "no-slots" ? v : null;
}

export default function FunnelPage() {
  const { lang, setLang, t } = useT();
  const [state, setState] = useState<FunnelStateLocal>(() => ({
    ...INITIAL_STATE,
    devMock: readDemoMock(),
  }));

  const patch = useCallback(
    (next: Partial<FunnelStateLocal>) => setState((s) => ({ ...s, ...next })),
    [],
  );

  // Stable callbacks — inline arrows here re-fire children's fetch effects in a loop.
  const onPricingStable = useCallback(
    (p: PricingResult) => setState((s) => ({ ...s, pricingResult: p })),
    [],
  );
  const onFrequencyStable = useCallback(
    (f: Frequency) => setState((s) => ({ ...s, frequency: f })),
    [],
  );
  const onTierStable = useCallback(
    (tt: Tier) => setState((s) => ({ ...s, confirmedTier: tt })),
    [],
  );
  const onToggleFixedStable = useCallback(
    (id: string) =>
      setState((s) => ({
        ...s,
        selectedAddOns: s.selectedAddOns.includes(id)
          ? s.selectedAddOns.filter((x) => x !== id)
          : [...s.selectedAddOns, id],
      })),
    [],
  );
  const onToggleOpenEndedStable = useCallback(
    (id: string) =>
      setState((s) => ({
        ...s,
        selectedOpenEndedAddOns: s.selectedOpenEndedAddOns.includes(id)
          ? s.selectedOpenEndedAddOns.filter((x) => x !== id)
          : [...s.selectedOpenEndedAddOns, id],
      })),
    [],
  );

  const go = useCallback((step: FunnelStep) => patch({ step }), [patch]);

  const onLangChange = useCallback(
    (l: Lang) => patch({ language: l }),
    [patch],
  );

  // ── step transitions ────────────────────────────────────────────────────
  const onIntent = (intent: string) => patch({ intent, step: "space_photos" });

  const onPhotos = (input: {
    address: string;
    photos: string[];
    assessment: VisionAssessment;
  }) => {
    const esc = escalationFromVision(input.assessment);
    if (esc) {
      patch({
        address: input.address,
        photos: input.photos,
        visionAssessment: input.assessment,
        escalation: esc,
        step: "human_review",
      });
      return;
    }
    // §B2 cleanup gating: high-confidence neglected → force cleanup into cart.
    const forceCleanup =
      input.assessment.cleanup_required &&
      input.assessment.cleanup_confidence === "high";
    const selectedFixed = forceCleanup
      ? Array.from(new Set([CLEANUP_GATING_ADDON_ID]))
      : [];
    patch({
      address: input.address,
      photos: input.photos,
      visionAssessment: input.assessment,
      recommendedTier: input.assessment.recommended_tier,
      confirmedTier: input.assessment.recommended_tier,
      selectedAddOns: selectedFixed,
      step: "tier_recommend",
    });
  };

  const onIdentity = (values: IdentityValues) =>
    patch({ identity: values, address: values.address, step: "quote" });

  const onHumanReviewSubmit = (values: {
    name: string;
    email: string;
    phone: string;
    address: string;
  }) => patch({ identity: values });

  const restart = () => setState({ ...INITIAL_STATE, language: state.language });

  // ── render the active step ──────────────────────────────────────────────
  const tier = state.confirmedTier ?? state.recommendedTier ?? "signature";
  const frequency: Frequency = state.frequency ?? "biweekly";

  let body: React.ReactNode = null;
  switch (state.step) {
    case "intent":
      body = <IntentStep initial={state.intent} onNext={onIntent} t={t} />;
      break;
    case "space_photos":
      body = (
        <SpacePhotosStep
          initialAddress={state.address}
          initialPhotos={state.photos}
          devMock={state.devMock ?? null}
          onBack={() => go("intent")}
          onNext={onPhotos}
          t={t}
        />
      );
      break;
    case "tier_recommend":
      body = state.visionAssessment ? (
        <TierRecommendStep
          assessment={state.visionAssessment}
          confirmedTier={state.confirmedTier}
          selectedFixed={state.selectedAddOns}
          selectedOpenEnded={state.selectedOpenEndedAddOns}
          onTierChange={onTierStable}
          onToggleFixed={onToggleFixedStable}
          onToggleOpenEnded={onToggleOpenEndedStable}
          onBack={() => go("space_photos")}
          onNext={() => go("identity")}
          t={t}
        />
      ) : null;
      break;
    case "identity":
      body = (
        <IdentityStep
          initial={state.identity}
          fallbackAddress={state.address}
          onBack={() => go("tier_recommend")}
          onNext={onIdentity}
          t={t}
        />
      );
      break;
    case "quote":
      body = (
        <QuoteStep
          tier={tier}
          frequency={frequency}
          selectedFixed={state.selectedAddOns}
          selectedOpenEnded={state.selectedOpenEndedAddOns}
          onFrequencyChange={onFrequencyStable}
          onPricing={onPricingStable}
          onBack={() => go("identity")}
          onNext={() => go("checkout")}
          t={t}
        />
      );
      break;
    case "checkout": {
      const id = state.identity;
      const identityComplete: IdentityValues | null =
        id && id.name && id.email && id.phone && id.address
          ? { name: id.name, email: id.email, phone: id.phone, address: id.address }
          : null;
      body =
        state.pricingResult && identityComplete ? (
          <CheckoutStep
            tier={tier}
            frequency={frequency}
            pricing={state.pricingResult}
            identity={identityComplete}
            selectedFixed={state.selectedAddOns}
            selectedOpenEnded={state.selectedOpenEndedAddOns}
            onBack={() => go("quote")}
            onSuccess={() => go("schedule")}
            t={t}
          />
        ) : null;
      break;
    }
    case "schedule":
      body = (
        <ScheduleStep
          devMock={state.devMock ?? null}
          selectedSlotId={state.selectedSlotId}
          onBack={() => go("quote")}
          onSelect={(slotId: string) => patch({ selectedSlotId: slotId })}
          onConfirm={() => go("confirmed")}
          onNoSlots={() => go("waitlist")}
          t={t}
          lang={lang}
        />
      );
      break;
    case "confirmed":
      body = <ConfirmedStep onRestart={restart} t={t} />;
      break;
    case "waitlist":
    case "human_review":
      body = (
        <HumanReviewStep
          escalation={
            state.escalation ?? {
              flags: ["no_slot_within_window"],
              primary: "no_slot_within_window",
              brief:
                "No slot available within the 14-day serve window. Customer added to the waitlist — do not charge. Offer the next opening when capacity frees up.",
              autoChargeBlocked: true,
            }
          }
          initial={state.identity}
          fallbackAddress={state.address}
          onSubmit={onHumanReviewSubmit}
          t={t}
        />
      );
      break;
  }

  return (
    <FunnelShell
      step={state.step}
      lang={lang}
      onLangChange={onLangChange}
      t={t}
      chatSlot={<ChatPanel t={t} funnelState={state} />}
    >
      {body}
    </FunnelShell>
  );
}
