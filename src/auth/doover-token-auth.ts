import { DooverAuth } from "./doover-auth";
import { DooverAuthError } from "./errors";
import { decodeTokenExpiry } from "./jwt";
import type { AuthProfile } from "./auth-profile";
import type { AuthProfileStore } from "./auth-store";

/** Buffer in milliseconds before expiry at which we trigger a refresh (30 s). */
const REFRESH_BUFFER_MS = 30_000;

export class DooverTokenAuth extends DooverAuth {
  private token: string | null;
  private tokenExpires: Date | null;
  private refreshToken: string | null;
  private refreshTokenId: string | null;
  private authServerUrl: string | null;
  private authServerClientId: string | null;
  private fetchImpl: typeof fetch;
  private refreshInFlight: Promise<void> | null = null;

  constructor(options: {
    token?: string | null;
    tokenExpires?: Date | number | null;
    refreshToken?: string | null;
    refreshTokenId?: string | null;
    authServerUrl?: string | null;
    authServerClientId?: string | null;
    fetchImpl?: typeof fetch;
  }) {
    super();
    this.token = options.token ?? null;
    this.tokenExpires = this.resolveExpiry(
      options.tokenExpires,
      options.token ?? null,
    );
    this.refreshToken = options.refreshToken ?? null;
    this.refreshTokenId = options.refreshTokenId ?? null;
    this.authServerUrl = options.authServerUrl ?? null;
    this.authServerClientId = options.authServerClientId ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  // ------------------------------------------------------------------
  // DooverAuth interface
  // ------------------------------------------------------------------

  async getHttpHeaders(): Promise<Record<string, string>> {
    if (!this.token) {
      return {};
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  getFetchCredentials(): RequestCredentials {
    return "omit";
  }

  async prepareWebSocket(
    url: string,
    canUseHeaders: boolean,
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    if (!this.token) {
      return { url };
    }
    if (canUseHeaders) {
      return {
        url,
        headers: { Authorization: `Bearer ${this.token}` },
      };
    }
    // Append token as a query parameter for browser-style WebSocket.
    const parsed = new URL(url);
    parsed.searchParams.set("token", this.token);
    return { url: parsed.toString() };
  }

  setToken(
    token: string | null,
    tokenExpires?: Date | number | null,
  ): void {
    this.token = token;
    this.tokenExpires = this.resolveExpiry(tokenExpires, token);
  }

  async ensureReady(): Promise<void> {
    if (!this.needsRefresh()) {
      return;
    }
    // Deduplicate concurrent refresh attempts.
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  // ------------------------------------------------------------------
  // Profile attachment override — load refresh metadata from profile
  // ------------------------------------------------------------------

  override attachProfile(
    profile: AuthProfile,
    configManager?: AuthProfileStore,
  ): void {
    super.attachProfile(profile, configManager);

    // Back-fill fields from the profile where not already set.
    if (!this.token && profile.token) {
      this.token = profile.token;
    }
    if (!this.tokenExpires && profile.tokenExpires) {
      this.tokenExpires = new Date(profile.tokenExpires);
    }
    if (!this.tokenExpires && this.token) {
      this.tokenExpires = decodeTokenExpiry(this.token);
    }
    if (!this.refreshToken && profile.refreshToken) {
      this.refreshToken = profile.refreshToken;
    }
    if (!this.refreshTokenId && profile.refreshTokenId) {
      this.refreshTokenId = profile.refreshTokenId;
    }
    if (!this.authServerUrl && profile.authServerUrl) {
      this.authServerUrl = profile.authServerUrl;
    }
    if (!this.authServerClientId && profile.authServerClientId) {
      this.authServerClientId = profile.authServerClientId;
    }
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private needsRefresh(): boolean {
    if (!this.token) {
      return true;
    }
    if (!this.tokenExpires) {
      return false;
    }
    return this.tokenExpires.getTime() - Date.now() < REFRESH_BUFFER_MS;
  }

  private async refresh(): Promise<void> {
    if (
      !this.authServerUrl ||
      !this.refreshToken ||
      !this.authServerClientId
    ) {
      throw new DooverAuthError(
        "Cannot refresh token: missing authServerUrl, refreshToken, or authServerClientId",
      );
    }

    const url = new URL(`${this.authServerUrl}/oauth2/token`);
    url.searchParams.set("grant_type", "refresh_token");
    if (this.token) {
      url.searchParams.set("access_token", this.token);
    }
    url.searchParams.set("refresh_token", this.refreshToken);
    url.searchParams.set("client_id", this.authServerClientId);

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "POST",
      });
    } catch (err) {
      throw new DooverAuthError(
        `Token refresh request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new DooverAuthError(
        `Token refresh failed with status ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };

    if (!body.access_token) {
      throw new DooverAuthError(
        "Token refresh response did not contain an access_token",
      );
    }

    this.token = body.access_token;
    this.tokenExpires =
      typeof body.expires_in === "number"
        ? new Date(Date.now() + body.expires_in * 1000)
        : decodeTokenExpiry(body.access_token);

    if (body.refresh_token) {
      this.refreshToken = body.refresh_token;
    }

    // Persist back to profile / config manager.
    this.persistToProfile();
  }

  private persistToProfile(): void {
    if (!this.profile) {
      return;
    }
    this.profile.token = this.token;
    this.profile.tokenExpires = this.tokenExpires
      ? this.tokenExpires.toISOString()
      : null;
    if (this.refreshToken) {
      this.profile.refreshToken = this.refreshToken;
    }
    if (this.configManager) {
      try {
        this.configManager.create(this.profile);
        this.configManager.write();
      } catch (err) {
        throw new DooverAuthError(
          `Failed to persist refreshed token: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private resolveExpiry(
    explicit: Date | number | null | undefined,
    token: string | null,
  ): Date | null {
    if (explicit instanceof Date) {
      return explicit;
    }
    if (typeof explicit === "number") {
      return new Date(explicit);
    }
    if (token) {
      return decodeTokenExpiry(token);
    }
    return null;
  }
}
