export type UsageFailure = "rejected" | "refused" | "rate-limited" | "unavailable" | "offline" | "format";

export class UsageRequestError extends Error {
  constructor(readonly reason: UsageFailure, message: string) {
    super(message);
    this.name = "UsageRequestError";
  }
}

export function unexpectedFormat(): UsageRequestError {
  return new UsageRequestError("format", "Unexpected usage format. Update AI Usage.");
}

export type UsageRequest = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
};

const TIMEOUT_MS = 15_000;

/**
 * One GET with an explicit policy: 15 s timeout, no redirects (the bearer token
 * never follows one), no retries (the service polls again), JSON only.
 */
export async function getJSON(request: UsageRequest): Promise<unknown> {
  const host = new URL(request.url).host;
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "ai-usage", ...request.headers },
      redirect: "manual",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch (error) {
    // fetch rejects with TypeError for network failures and with AbortError/TimeoutError when cancelled.
    if (error instanceof TypeError || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
      throw new UsageRequestError("offline", `Couldn't reach ${host}. Check your connection.`);
    }
    throw error;
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    switch (response.status) {
      case 401: throw new UsageRequestError("rejected", `${host} rejected the saved sign-in.`);
      case 403: throw new UsageRequestError("refused", `${host} refused the usage request (HTTP 403).`);
      case 429: throw new UsageRequestError("rate-limited", "Usage checks are rate-limited. Retrying later.");
      default: throw new UsageRequestError("unavailable", `${host} returned HTTP ${response.status}. Retrying later.`);
    }
  }
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw unexpectedFormat();
    throw error;
  }
}
