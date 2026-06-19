// Pure intent decoder — parse Meta ad URL params into service intent.
// No network, no env, no side effects.

export interface Intent {
  service?: "mowing" | "cleanup" | "recurring";
  frequency?: "weekly" | "biweekly" | "monthly";
  zip?: string;
  raw?: string;
}

export function decodeIntent(searchParams: Record<string, string>): Intent {
  const result: Intent = {};

  // Priority order: intent > utm_content > svc
  const intentStr = searchParams.intent || searchParams.utm_content || searchParams.svc;

  if (intentStr) {
    result.raw = intentStr;

    // Extract service from intent string
    const service = parseService(intentStr);
    if (service) {
      result.service = service;
    }

    // Extract frequency from intent string (e.g., "weekly_mowing" → "weekly")
    const freq = parseFrequency(intentStr);
    if (freq) {
      result.frequency = freq;
    }
  }

  // Explicit freq param overrides embedded frequency
  if (searchParams.freq) {
    const freq = parseFrequency(searchParams.freq);
    if (freq) {
      result.frequency = freq;
    }
  }

  // Zip code
  if (searchParams.zip) {
    result.zip = searchParams.zip;
  }

  return result;
}

function parseService(str: string): "mowing" | "cleanup" | "recurring" | undefined {
  const lower = str.toLowerCase();

  // Mowing aliases
  if (lower === "mow" || lower === "mowing" || lower.includes("mowing")) {
    return "mowing";
  }

  // Cleanup aliases
  if (lower === "clean" || lower === "cleanup" || lower.includes("cleanup")) {
    return "cleanup";
  }

  // Recurring aliases
  if (
    lower === "recurring" ||
    lower === "maintenance" ||
    lower.includes("maintenance") ||
    lower.includes("recurring")
  ) {
    return "recurring";
  }

  return undefined;
}

function parseFrequency(str: string): "weekly" | "biweekly" | "monthly" | undefined {
  const lower = str.toLowerCase();

  // Check biweekly FIRST (before weekly, since it contains "weekly")
  if (lower.includes("biweekly")) {
    return "biweekly";
  }

  if (lower.includes("weekly")) {
    return "weekly";
  }

  if (lower.includes("monthly")) {
    return "monthly";
  }

  return undefined;
}
