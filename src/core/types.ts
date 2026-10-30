export type ProviderId = "claude" | "openai";

/** One allowance window, such as the 5-hour session or the weekly limit. */
export type UsageWindow = {
  readonly id: string;
  readonly label: string;
  /** Percent of the allowance used, 0–100 (can exceed 100 when a limit is overrun). */
  readonly usedPercent: number;
  /** ISO timestamp, or null when the provider did not report one. */
  readonly resetsAt: string | null;
};

export type UsageSnapshot = {
  readonly observedAt: string;
  readonly windows: readonly UsageWindow[];
};

/**
 * - loading: the first check is running; there is no snapshot yet.
 * - ready: the snapshot comes from the latest check.
 * - signed-out: OpenCode has no subscription sign-in for this provider; no snapshot.
 * - expired: OpenCode's saved sign-in has expired; the snapshot, if any, is the last reading.
 * - error: the latest check failed; the snapshot, if any, is the last reading.
 */
export type ProviderStatus = "loading" | "ready" | "signed-out" | "expired" | "error";

export type ProviderView = {
  readonly id: ProviderId;
  readonly title: string;
  readonly status: ProviderStatus;
  readonly snapshot: UsageSnapshot | null;
  /** Short user-facing explanation for every status except ready and loading. */
  readonly message: string | null;
};

export type Dashboard = {
  readonly providers: readonly ProviderView[];
  readonly refreshing: boolean;
  /** When the last check finished, or null before the first one. */
  readonly updatedAt: string | null;
  readonly demo: boolean;
};

export class TrackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackerError";
  }
}

export function assertNever(value: never): never {
  throw new TrackerError(`Unexpected application state: ${String(value)}`);
}

export function errorMessage(error: unknown): string {
  if (error instanceof TrackerError) return error.message;
  if (error instanceof Error) return "The local operation failed. Try Refresh.";
  return "The operation could not be completed. Try Refresh.";
}
