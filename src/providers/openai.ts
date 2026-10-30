import { isNonEmptyString, isNumber, isRecord } from "../core/json";
import type { UsageWindow } from "../core/types";
import { getJSON, unexpectedFormat } from "./http";
import type { SubscriptionLogin } from "./opencode-auth";

/** The endpoint Codex uses for its Work/Codex allowance; OpenCode draws on the same allowance. */
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

type Window = { readonly usedPercent: number; readonly seconds: number | null; readonly resetAt: number | null; readonly resetAfter: number | null };

function period(seconds: number | null): string {
  if (seconds === null) return "Usage";
  const minutes = Math.round(seconds / 60);
  if (minutes === 300) return "5-hour";
  if (minutes === 10_080) return "Weekly";
  if (minutes >= 1_440) return `${Math.round(minutes / 1_440)}-day`;
  if (minutes >= 60) return `${Math.round(minutes / 60)}-hour`;
  return `${minutes}-minute`;
}

/** null for an empty slot, undefined for a malformed one. */
function readWindow(value: unknown): Window | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const { used_percent: used, limit_window_seconds: seconds, reset_at: resetAt, reset_after_seconds: resetAfter } = value;
  if (!isNumber(used)) return undefined;
  return {
    usedPercent: used,
    seconds: isNumber(seconds) && seconds > 0 ? seconds : null,
    resetAt: isNumber(resetAt) ? resetAt : null,
    resetAfter: isNumber(resetAfter) ? resetAfter : null,
  };
}

function resetTime(window: Window, now: number): string | null {
  if (window.resetAt !== null) return new Date(window.resetAt * 1_000).toISOString();
  return window.resetAfter === null ? null : new Date(now + window.resetAfter * 1_000).toISOString();
}

/** Shortest window first; `name` labels an additional (model-specific) allowance. Undefined when malformed. */
function windowsOf(limit: unknown, name: string | null, now: number): UsageWindow[] | undefined {
  if (limit === null || limit === undefined) return [];
  if (!isRecord(limit)) return undefined;
  const slots = [readWindow(limit["primary_window"]), readWindow(limit["secondary_window"])];
  if (slots.includes(undefined)) return undefined;
  return slots
    .filter((window) => window !== null && window !== undefined)
    .sort((left, right) => (left.seconds ?? 0) - (right.seconds ?? 0))
    .map((window) => {
      const label = period(window.seconds);
      return {
        id: `${name ?? "main"}:${window.seconds ?? "unknown"}`,
        label: name === null ? label : `${name} ${label.toLowerCase()}`,
        usedPercent: window.usedPercent,
        resetsAt: resetTime(window, now),
      };
    });
}

/** Same precedence OpenCode uses when it sends ChatGPT-Account-Id. */
function accountIdFromToken(token: string): string | null {
  const payload = token.split(".")[1];
  if (payload === undefined) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(claims)) return null;
  const direct = claims["chatgpt_account_id"];
  if (isNonEmptyString(direct)) return direct;
  const auth = claims["https://api.openai.com/auth"];
  const nested = isRecord(auth) ? auth["chatgpt_account_id"] : undefined;
  if (isNonEmptyString(nested)) return nested;
  const organizations = claims["organizations"];
  const first: unknown = Array.isArray(organizations) ? organizations[0] : undefined;
  const id = isRecord(first) ? first["id"] : undefined;
  return isNonEmptyString(id) ? id : null;
}

function extraName(extra: Readonly<Record<string, unknown>>): string {
  const { limit_name: limitName, metered_feature: feature } = extra;
  if (isNonEmptyString(limitName)) return limitName;
  return isNonEmptyString(feature) ? feature : "Additional";
}

/** Reads ChatGPT subscription (Work/Codex) limits with the access token OpenCode saved. */
export async function fetchOpenAIUsage(login: SubscriptionLogin, signal: AbortSignal): Promise<readonly UsageWindow[]> {
  const accountId = login.accountId ?? accountIdFromToken(login.accessToken);
  const body = await getJSON({
    url: USAGE_URL,
    signal,
    headers: { Authorization: `Bearer ${login.accessToken}`, ...(accountId === null ? {} : { "ChatGPT-Account-Id": accountId }) },
  });
  if (!isRecord(body)) throw unexpectedFormat();
  const now = Date.now();
  const main = windowsOf(body["rate_limit"], null, now);
  if (main === undefined) throw unexpectedFormat();
  const additional = body["additional_rate_limits"];
  const extras: readonly unknown[] = Array.isArray(additional) ? additional : [];
  return [
    ...main,
    ...extras.flatMap((extra) => (isRecord(extra) ? windowsOf(extra["rate_limit"], extraName(extra), now) ?? [] : [])),
  ];
}
