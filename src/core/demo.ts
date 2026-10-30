import type { Dashboard } from "./types";

/** Illustrative data for the plugin's demo option; never derived from an account. */
export function demoDashboard(): Dashboard {
  const now = new Date();
  const observedAt = now.toISOString();
  const reset = (hours: number): string => new Date(now.getTime() + hours * 3_600_000).toISOString();
  return {
    demo: true,
    refreshing: false,
    updatedAt: observedAt,
    providers: [
      {
        id: "claude", title: "Claude", status: "ready", message: null,
        snapshot: {
          observedAt,
          windows: [
            { id: "session", label: "5-hour", usedPercent: 82, resetsAt: reset(2.25) },
            { id: "weekly", label: "Weekly", usedPercent: 58, resetsAt: reset(51) },
            { id: "weekly:Fable", label: "Fable weekly", usedPercent: 31, resetsAt: reset(51) },
          ],
        },
      },
      {
        id: "openai", title: "ChatGPT", status: "ready", message: null,
        snapshot: { observedAt, windows: [{ id: "weekly", label: "Weekly", usedPercent: 24, resetsAt: reset(164) }] },
      },
    ],
  };
}
