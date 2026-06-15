// EN i18n strings for the Go Green web funnel.
// Premium / warm / no-pressure voice. Mirror EN/ES structure across both files.

export const en = {
  common: {
    next: "Continue",
    back: "Back",
    cancel: "Cancel",
    loading: "One moment…",
    error: "Something went sideways. Please try again.",
    optional: "optional",
    required: "required",
    perVisit: "per visit",
    perMonth: "per month",
    starting: "Starting at",
    onSiteCaveat: "Starting at — final price confirmed on-site.",
    lang: { en: "EN", es: "ES" },
  },
  brand: {
    company: "Go Green Landscape",
    badge: "Premium garden care · San Francisco",
  },
  progress: {
    intent: "Your space",
    space_photos: "Photos",
    tier_recommend: "Plan",
    identity: "About you",
    quote: "Quote",
    checkout: "Payment",
    schedule: "Schedule",
    confirmed: "Confirmed",
  },
  funnel: {
    header: {
      title: "Care your garden deserves",
      subtitle:
        "Tell us about your outdoor space — we'll suggest the right plan, then book your first visit.",
    },
    intent: {
      title: "What brings you here?",
      prompt:
        "In a few words, what would you like us to take care of? Recurring upkeep, a tired front yard, a tricky hedge — whatever's on your mind.",
      placeholder: "e.g. Weekly upkeep for a small front yard with hedges and a planter…",
      cta: "Continue",
      reassurance:
        "No pressure — you'll see the plan and pricing before anything is booked.",
    },
    photos: {
      title: "Your space, in pictures",
      subtitle:
        "Add 1–6 photos of the area we'd be caring for, plus the service address. The clearer the view, the better the plan we'll recommend.",
      addressLabel: "Service address",
      addressPlaceholder: "Street, city, ZIP",
      addressHint: "Used to confirm coverage and visit logistics.",
      uploadCta: "Add photos",
      uploadHint: "JPEG or PNG · up to 10MB each · 1–6 photos",
      remaining: (n: number) => `${n} of 6`,
      removePhoto: "Remove",
      analyzing: "Reading your photos…",
      analysisError: "We couldn't analyze those photos. Try different angles?",
      cta: "See my plan",
      privacyNote:
        "Photos are used only to recommend care and are never shared outside the team.",
    },
    tier: {
      title: "We'd suggest this plan",
      subtitle: "Three levels of care. You choose the cadence at the quote step.",
      recommendedBadge: "Recommended for you",
      selectCta: "Choose this plan",
      selected: "Selected",
      includes: "Included",
      notIncluded: "Quoted separately",
      whyRecommended: "Why we suggested it",
      cta: "Continue with this plan",
      assessment: {
        size: "Yard size",
        condition: "Condition score",
        of10: "/ 10",
        confidence: "AI confidence",
      },
      addOns: {
        title: "Add-ons we noticed",
        subtitle:
          "Common extras we spotted in your photos. Add what you'd like — remove anything you don't.",
        emptyState: "No extras spotted — your space looks great.",
        addedToCart: "Added to first visit",
      },
      humanQuote: {
        title: "Items we'd quote separately",
        subtitle:
          "These need an on-site look. We'll send a tailored quote — they're not charged now.",
        badge: "Quoted separately by a human — not charged now.",
        addCta: "Add to human quote",
        addedCta: "Will be quoted",
      },
      cleanupGate: {
        requiredTitle: "One-time cleanup required first",
        requiredBody:
          "Your photos show a level of overgrowth that needs a one-time cleanup before recurring care can begin. It's added to your first visit.",
        recommendedTitle: "We'd recommend a one-time cleanup first",
        recommendedBody:
          "A cleanup gives recurring care a clean slate. You can include it now or skip it.",
        dismiss: "Skip for now",
        include: "Include cleanup",
      },
    },
    identity: {
      title: "A little about you",
      subtitle:
        "We use this only to confirm your visit and send the work order — no list, no spam.",
      nameLabel: "Full name",
      namePlaceholder: "Your name",
      emailLabel: "Email",
      emailPlaceholder: "you@email.com",
      phoneLabel: "Phone",
      phonePlaceholder: "(415) 555-0100",
      addressLabel: "Service address",
      addressPlaceholder: "Street, city, ZIP",
      addressRequired: "Address is required to schedule a visit.",
      cta: "See my quote",
    },
    quote: {
      title: "Your quote",
      subtitle:
        "Transparent, productized, no hidden fees. Final price is confirmed by your crew on-site.",
      frequencyLabel: "How often?",
      frequency: {
        weekly: "Weekly",
        biweekly: "Every two weeks",
        monthly: "Monthly",
      },
      baseLabel: "Plan",
      perVisitLabel: "Per visit",
      monthlyRecurringLabel: "Monthly plan",
      addOnsLabel: "Add-ons (first visit)",
      humanQuoteLabel: "Will be quoted separately",
      dueToday: "Due today",
      renewsMonthly: "Renews monthly",
      onSiteCaveat: "Starting at — final price confirmed on-site after the first visit.",
      assumptions: "Assumptions",
      cta: "Continue to payment",
      guarantee:
        "First-visit satisfaction guarantee: if the property doesn't match, we re-quote or refund before anything recurring locks in.",
    },
    checkout: {
      title: "Secure checkout",
      subtitle:
        "We use Stripe to handle payment safely. You won't be charged until you confirm.",
      mockBadge: "Stripe · test mode",
      simulateCta: "Pay & continue",
      cancelCta: "Back to quote",
      processing: "Connecting to Stripe…",
    },
    schedule: {
      title: "Pick your first visit",
      subtitle:
        "Four windows per day, Thursday onward. Choose the slot that fits your week.",
      cta: "Confirm this slot",
      noSlots: "No availability in the next two weeks",
      crewSize: (n: number) => `Crew of ${n}`,
      slotWindows: {
        morning: "Morning",
        midday: "Midday",
        afternoon: "Afternoon",
        evening: "Evening",
      },
    },
    confirmed: {
      title: "You're booked",
      subtitle:
        "Your first visit is on the calendar. We'll text the day before with crew details and an arrival window.",
      whatNext: "What happens next",
      step1: "We confirm by email within the hour.",
      step2: "Crew arrives in the chosen window, fully equipped.",
      step3: "After the visit, your monthly plan locks in only when you're happy.",
      cta: "Back to start",
    },
    humanReview: {
      title: "Let's have a human look at this",
      subtitle:
        "A few details about your request need a closer eye than we can give online. We'll be in touch within 1 business day — no charge.",
      brief: "Here's what we'll pass along to the team:",
      reasonLabel: "Why",
      contactTitle: "Where can we reach you?",
      cta: "Send to the team",
      sentTitle: "Thank you — we've got it.",
      sentSubtitle: "A specialist will reach out within 1 business day.",
    },
    waitlist: {
      title: "You're on the list",
      subtitle:
        "We don't have an opening in the next 14 days, so we won't charge anything yet. As soon as a slot opens, we'll offer it first.",
      capacityExplain:
        "We hold a 2-week service window so every visit gets the time it deserves.",
      contactTitle: "Where should we reach you when a slot opens?",
      cta: "Add me to the list",
      sentTitle: "You're on the list.",
      sentSubtitle: "We'll reach out the moment a slot opens up.",
    },
    chat: {
      openCta: "Questions? Ask the concierge",
      title: "Your garden concierge",
      subtitle: "Fill out the form to book — ask me anything along the way.",
      placeholder: "Ask about plans, pricing, or your visit…",
      sending: "Thinking…",
      emptyStateGreeting:
        "Hi — the form on the left books your service. I'm here for any questions: plans, pricing, photos, or what to expect.",
      closeCta: "Close",
    },
  },
};

export type Dict = typeof en;
