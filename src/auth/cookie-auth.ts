import { DooverAuth } from "./doover-auth.js";

/** Default FusionAuth hosted-backend refresh endpoint. */
const DEFAULT_REFRESH_PATH = "/app/refresh/";
/** Default name of the cookie holding the access token's expiry (Unix seconds). */
const DEFAULT_EXPIRY_COOKIE = "app.at_exp";
/**
 * How long a refresh result is reused. Collapses the burst of callers that all
 * discover an expired token at the same moment (every queued request 401-ing
 * after a tab wakes up), and — more importantly — stops a *failed* refresh from
 * being retried in a tight loop.
 */
const ATTEMPT_TTL_MS = 5_000;

export interface CookieAuthOptions {
  /**
   * Base URL of the auth server that serves the hosted-backend refresh
   * endpoint. Required for any refresh behaviour; without it `CookieAuth`
   * behaves exactly as it always has (no refresh, no recovery).
   */
  authServerUrl?: string | null;
  /** Refresh endpoint path. Defaults to `/app/refresh/`. */
  refreshPath?: string;
  /** Name of the access-token expiry cookie. Defaults to `app.at_exp`. */
  accessTokenExpiryCookieName?: string;
  /** Override `fetch` (tests, native hosts). */
  fetchImpl?: typeof fetch;
  /** Override how the cookie string is read. Defaults to `document.cookie`. */
  cookieReader?: () => string;
}

/**
 * Cookie-based auth — the default browser strategy.
 *
 * Relies on ambient cookies (`credentials: "include"`) and does not add any
 * `Authorization` header. The access token itself is httpOnly and invisible to
 * JS; the only readable part of the session is a companion expiry cookie
 * (`app.at_exp`).
 *
 * ## Why this refreshes
 *
 * The FusionAuth React SDK's auto-refresh is a single `setTimeout` per token.
 * A browser that suspends the tab (backgrounded, laptop asleep) never fires it,
 * so the tab wakes with an expired access-token cookie and every request 401s —
 * even though the refresh token itself is usually still valid. Rather than
 * leaving every browser app to work around that on its own, `CookieAuth`
 * handles it whenever `authServerUrl` is configured: `ensureReady` renews an
 * already-expired token before a request goes out (which also covers gateway
 * reconnects, since `GatewayClient` awaits it before opening a socket), and
 * `handleUnauthorized` lets `RestClient` replay a 401 once after a renewal.
 */
export class CookieAuth extends DooverAuth {
  private readonly authServerUrl: string | null;
  private readonly refreshPath: string;
  private readonly expiryCookieName: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cookieReader: (() => string) | null;

  private refreshInFlight: Promise<boolean> | null = null;
  private lastAttempt: { result: boolean; at: number } | null = null;

  constructor(options: CookieAuthOptions = {}) {
    super();
    this.authServerUrl = options.authServerUrl ?? null;
    this.refreshPath = options.refreshPath ?? DEFAULT_REFRESH_PATH;
    this.expiryCookieName =
      options.accessTokenExpiryCookieName ?? DEFAULT_EXPIRY_COOKIE;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.cookieReader = options.cookieReader ?? null;
  }

  // ------------------------------------------------------------------
  // DooverAuth interface
  // ------------------------------------------------------------------

  async getHttpHeaders(): Promise<Record<string, string>> {
    return {};
  }

  getFetchCredentials(): RequestCredentials {
    return "include";
  }

  async prepareWebSocket(
    url: string,
    _canUseHeaders: boolean,
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    // Cookie auth relies on ambient cookies — no URL or header changes.
    return { url };
  }

  setToken(
    _token: string | null,
    _tokenExpires?: Date | number | null,
  ): void {
    // No-op for cookie auth — the token lives in an httpOnly cookie.
  }

  setRefreshToken(_refreshToken: string | null): void {
    // No-op for cookie auth — the refresh token lives in an httpOnly cookie.
  }

  /**
   * Renew the access token when it has already expired, so the request that
   * follows isn't a guaranteed 401. A token that is merely close to expiry is
   * left alone: requests must not block on a refresh they don't need, and
   * `handleUnauthorized` is there for the race.
   */
  async ensureReady(): Promise<void> {
    if (!this.canRefresh()) {
      return;
    }
    if (this.isAccessTokenValid()) {
      return;
    }
    // A failed refresh is not fatal here — let the request go out and be
    // handled by `handleUnauthorized` / the caller's error handling.
    await this.refreshAccessToken();
  }

  /**
   * Called by `RestClient` after a 401. A successful refresh means the request
   * is worth replaying once.
   */
  override async handleUnauthorized(): Promise<boolean> {
    if (!this.canRefresh()) {
      return false;
    }
    return this.refreshAccessToken();
  }

  // ------------------------------------------------------------------
  // Public helpers — apps need these for their own lifecycle hooks
  // ------------------------------------------------------------------

  /** Expiry of the current access token, or `null` if there is no session. */
  getAccessTokenExpiry(): Date | null {
    const expiryMs = this.readExpiryCookie();
    return expiryMs == null ? null : new Date(expiryMs);
  }

  /** True when a session cookie exists and has not yet expired. */
  isAccessTokenValid(): boolean {
    const expiryMs = this.readExpiryCookie();
    return expiryMs != null && expiryMs > Date.now();
  }

  /**
   * True when the access token expires within `thresholdMs` (or already has).
   * Apps use this to decide whether a `visibilitychange` is worth a proactive
   * refresh. False when there is no session at all — nothing to refresh.
   */
  isAccessTokenStale(thresholdMs = 60_000): boolean {
    const expiryMs = this.readExpiryCookie();
    if (expiryMs == null) {
      return false;
    }
    return expiryMs - Date.now() < thresholdMs;
  }

  /**
   * Refresh the access token, returning whether a valid one is now in place.
   * Concurrent callers share one request, and the result is reused briefly so
   * a burst of 401s costs a single round-trip.
   *
   * Safe to call directly — e.g. from a `visibilitychange` handler when
   * {@link isAccessTokenStale} says the token is nearly up.
   */
  async refreshAccessToken(): Promise<boolean> {
    if (!this.canRefresh()) {
      return false;
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    // No expiry cookie means we were never logged in, or have since logged
    // out. The refresh endpoint would just 400.
    if (this.readExpiryCookie() == null) {
      return false;
    }
    if (this.lastAttempt && Date.now() - this.lastAttempt.at < ATTEMPT_TTL_MS) {
      return this.lastAttempt.result;
    }

    const inFlight = this.performRefresh().then((result) => {
      this.lastAttempt = { result, at: Date.now() };
      this.refreshInFlight = null;
      return result;
    });

    this.refreshInFlight = inFlight;
    return inFlight;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private canRefresh(): boolean {
    return this.authServerUrl != null && this.authServerUrl !== "";
  }

  private async performRefresh(): Promise<boolean> {
    const url = `${this.authServerUrl}${this.refreshPath}`;
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "text/plain" },
      });
      return response.ok;
    } catch {
      // Offline, DNS failure, blocked request — indistinguishable from here,
      // and all mean "no new token".
      return false;
    }
  }

  /** The expiry cookie in epoch milliseconds, or `null` when absent. */
  private readExpiryCookie(): number | null {
    const cookieString = this.readCookieString();
    if (!cookieString) {
      return null;
    }
    const match = cookieString.match(
      new RegExp(`(?:^|;\\s*)${escapeRegExp(this.expiryCookieName)}=([^;]+)`),
    );
    if (!match) {
      return null;
    }
    // Stored as Unix *seconds* (matching the FusionAuth SDK's own parser);
    // callers compare against Date.now(), so normalise to milliseconds.
    const seconds = parseInt(decodeURIComponent(match[1]), 10);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  private readCookieString(): string | null {
    if (this.cookieReader) {
      return this.cookieReader();
    }
    if (typeof document === "undefined") {
      return null;
    }
    return document.cookie;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
