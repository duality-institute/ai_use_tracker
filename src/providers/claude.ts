import { isNonEmptyString, isNumber, isRecord } from "../core/json";
import type { UsageWindow } from "../core/types";
import { getJSON, unexpectedFormat } from "./http";
import type { SubscriptionLogin } from "./opencode-auth";

/** Undocumented endpoint behind claude.ai/settings/usage; needs the OAuth beta header. */
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

const KIND_LABELS: Readonly<Record<string, string>> = { session: "5-hour", weekly_all: "Weekly" };
const LEGACY = [
  ["five_hour", "5-hour"],
  ["seven_day", "Weekly"],
  ["seven_day_opus", "Opus weekly"],
  ["seven_day_sonnet", "Sonnet weekly"],
] as const;

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function displayName(value: unknown): string | undefined {
  const name = isRecord(value) ? value["display_name"] : undefined;
  return isNonEmptyString(name) ? name : undefined;
}

/** "weekly_scoped" limits name their model (for example Fable); unknown kinds keep a readable label. */
function limitLabel(kind: string, scope: unknown): string {
  if (kind === "weekly_scoped") {
    const name = isRecord(scope) ? displayName(scope["model"]) ?? displayName(scope["surface"]) : undefined;
    return name === undefined ? "Scoped weekly" : `${name} weekly`;
  }
  const known = KIND_LABELS[kind];
  if (known !== undefined) return known;
  const words = kind.replaceAll("_", " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function limitWindow(item: unknown): UsageWindow[] {
  if (!isRecord(item)) return [];
  const { kind, percent } = item;
  if (!isNonEmptyString(kind) || !isNumber(percent)) return [];
  const label = limitLabel(kind, item["scope"]);
  return [{ id: `${kind}:${label}`, label, usedPercent: percent, resetsAt: isoOrNull(item["resets_at"]) }];
}

/** Reads Claude subscription limits with the access token OpenCode saved. */
export async function fetchClaudeUsage(login: SubscriptionLogin, signal: AbortSignal): Promise<readonly UsageWindow[]> {
  const body = await getJSON({
    url: USAGE_URL,
    signal,
    headers: { Authorization: `Bearer ${login.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
  });
  if (!isRecord(body)) throw unexpectedFormat();
  const limits = body["limits"];
  if (limits !== undefined && limits !== null && !Array.isArray(limits)) throw unexpectedFormat();
  const items: readonly unknown[] = Array.isArray(limits) ? limits : [];
  const windows = items.flatMap(limitWindow);
  if (windows.length > 0) return windows;
  // Older responses carry only the fixed windows.
  return LEGACY.flatMap(([key, label]) => {
    const window = body[key];
    const used = isRecord(window) ? window["utilization"] : undefined;
    return isRecord(window) && isNumber(used) ? [{ id: key, label, usedPercent: used, resetsAt: isoOrNull(window["resets_at"]) }] : [];
  });
}
