import { fetchClaudeUsage } from "../providers/claude";
import { UsageRequestError } from "../providers/http";
import { fetchOpenAIUsage } from "../providers/openai";
import { readOpenCodeLogins } from "../providers/opencode-auth";
import type { OpenCodeLogin, SubscriptionLogin } from "../providers/opencode-auth";
import { demoDashboard } from "./demo";
import { assertNever, errorMessage } from "./types";
import type { Dashboard, ProviderId, ProviderView, UsageWindow } from "./types";

/** Background check interval. The usage endpoints are private, so stay polite. */
const POLL_MS = 5 * 60_000;
/** Showing the panel checks again when the last check is older than this. */
const STALE_MS = 60_000;

const PRODUCTS: Readonly<Record<ProviderId, string>> = { claude: "Claude", openai: "ChatGPT" };

function fetchWindows(provider: ProviderId, login: SubscriptionLogin, signal: AbortSignal): Promise<readonly UsageWindow[]> {
  switch (provider) {
    case "claude": return fetchClaudeUsage(login, signal);
    case "openai": return fetchOpenAIUsage(login, signal);
    default: return assertNever(provider);
  }
}

function initial(id: ProviderId): ProviderView {
  return { id, title: PRODUCTS[id], status: "loading", snapshot: null, message: null };
}

/**
 * Reads limits with the sign-ins OpenCode already saved. It never refreshes,
 * stores, or writes a token: when OpenCode's token expires, the last reading
 * stays visible until OpenCode renews the sign-in.
 */
export class UsageService {
  private state: Dashboard;
  private readonly listeners = new Set<(state: Dashboard) => void>();
  private readonly abort = new AbortController();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: { readonly demo: boolean; readonly polling?: boolean }) {
    this.state = options.demo ? demoDashboard() : {
      providers: [initial("claude"), initial("openai")], refreshing: false, updatedAt: null, demo: false,
    };
  }

  getState(): Dashboard { return this.state; }

  subscribe(listener: (state: Dashboard) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Checks once, then every five minutes unless polling is false. */
  async initialize(): Promise<void> {
    if (this.options.demo) return;
    await this.refresh();
    if (this.options.polling === false || this.abort.signal.aborted) return;
    this.timer = setInterval(() => { void this.refresh(); }, POLL_MS);
  }

  /** Never rejects: failures become provider states. Concurrent calls share one check. */
  refresh(): Promise<void> {
    if (this.options.demo || this.abort.signal.aborted) return Promise.resolve();
    this.running ??= this.check().finally(() => { this.running = null; });
    return this.running;
  }

  refreshIfStale(): Promise<void> {
    const last = this.state.updatedAt === null ? 0 : Date.parse(this.state.updatedAt);
    return Date.now() - last < STALE_MS ? Promise.resolve() : this.refresh();
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.abort.abort();
    this.listeners.clear();
  }

  private async check(): Promise<void> {
    this.update({ refreshing: true });
    try {
      const logins = await readOpenCodeLogins();
      const providers = await Promise.all(this.state.providers.map((provider) => this.checkProvider(provider, logins[provider.id])));
      this.update({ providers, updatedAt: new Date().toISOString() });
    } catch (error) {
      // The background refresh boundary exposes sanitized errors, never raw credential-file errors.
      const message = errorMessage(error);
      this.update({
        updatedAt: new Date().toISOString(),
        providers: this.state.providers.map((provider) => ({ ...provider, status: "error", message })),
      });
    } finally {
      this.update({ refreshing: false });
    }
  }

  private checkProvider(previous: ProviderView, login: OpenCodeLogin): Promise<ProviderView> {
    switch (login.kind) {
      case "none":
        return Promise.resolve({ ...previous, status: "signed-out", snapshot: null, message: `Not signed in to ${PRODUCTS[previous.id]} in OpenCode.` });
      case "api-key":
        return Promise.resolve({ ...previous, status: "signed-out", snapshot: null, message: "OpenCode uses an API key here, which has no subscription limits." });
      case "subscription": return this.checkSubscription(previous, login);
      default: return assertNever(login);
    }
  }

  private async checkSubscription(previous: ProviderView, login: SubscriptionLogin): Promise<ProviderView> {
    const expired: ProviderView = {
      ...previous, status: "expired", message: `Sign-in expired. Use ${PRODUCTS[previous.id]} in OpenCode to renew it.`,
    };
    if (login.expiresAt <= Date.now()) return expired;
    try {
      const windows = await fetchWindows(previous.id, login, this.abort.signal);
      if (windows.length === 0) return { ...previous, status: "error", message: "No usage limits were reported for this account." };
      return { ...previous, status: "ready", snapshot: { observedAt: new Date().toISOString(), windows }, message: null };
    } catch (error) {
      if (!(error instanceof UsageRequestError)) throw error;
      return error.reason === "rejected" ? expired : { ...previous, status: "error", message: error.message };
    }
  }

  private update(change: Partial<Dashboard>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}
