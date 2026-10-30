import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isNonEmptyString, isNumber, isRecord } from "../core/json";
import { TrackerError, type ProviderId } from "../core/types";

export type SubscriptionLogin = {
  readonly kind: "subscription";
  readonly accessToken: string;
  /** Epoch milliseconds, as OpenCode stores it. */
  readonly expiresAt: number;
  readonly accountId: string | null;
};

export type OpenCodeLogin = { readonly kind: "none" } | { readonly kind: "api-key" } | SubscriptionLogin;
export type OpenCodeLogins = Readonly<Record<ProviderId, OpenCodeLogin>>;

const AUTH_KEYS = { claude: "anthropic", openai: "openai" } as const satisfies Record<ProviderId, string>;

/** OpenCode keeps sign-ins in $XDG_DATA_HOME/opencode/auth.json; an empty XDG_DATA_HOME counts as unset. */
export function openCodeAuthPath(): string {
  return join(process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share"), "opencode", "auth.json");
}

// Only the access token, expiry, and account id are copied; the refresh token never leaves the file.
function toLogin(entry: unknown): OpenCodeLogin {
  if (!isRecord(entry)) return { kind: "none" };
  const { type, access, expires, accountId } = entry;
  if (type === "api" || type === "wellknown") return { kind: "api-key" };
  if (type !== "oauth" || !isNonEmptyString(access) || !isNumber(expires)) return { kind: "none" };
  return { kind: "subscription", accessToken: access, expiresAt: expires, accountId: isNonEmptyString(accountId) ? accountId : null };
}

/** Reads OpenCode's saved sign-ins. Never writes the file and never refreshes a token. */
export async function readOpenCodeLogins(): Promise<OpenCodeLogins> {
  const path = openCodeAuthPath();
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { claude: { kind: "none" }, openai: { kind: "none" } };
    if (error instanceof Error && "code" in error) throw new TrackerError(`Can't read OpenCode's sign-ins (${path}).`);
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw new TrackerError(`OpenCode's sign-in file is not valid JSON (${path}).`);
    throw error;
  }
  if (!isRecord(data)) throw new TrackerError(`OpenCode's sign-in file has an unexpected format (${path}).`);
  return { claude: toLogin(data[AUTH_KEYS.claude]), openai: toLogin(data[AUTH_KEYS.openai]) };
}
