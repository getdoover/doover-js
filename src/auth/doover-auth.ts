import type { AuthProfile } from "./auth-profile";
import type { AuthProfileStore } from "./auth-store";

/**
 * Abstract base class shared by cookie and token auth strategies.
 *
 * Every client (`RestClient`, `GatewayClient`, `DooverDataProvider`) holds a
 * reference to one `DooverAuth` instance so that refreshed tokens propagate
 * everywhere automatically.
 */
export abstract class DooverAuth {
  protected profile: AuthProfile | null = null;
  protected configManager: AuthProfileStore | null = null;

  /** Headers to merge into every outgoing HTTP request. */
  abstract getHttpHeaders(): Promise<Record<string, string>>;

  /** The `credentials` value for `fetch()`. */
  abstract getFetchCredentials(): RequestCredentials;

  /**
   * Prepare websocket connection parameters.
   *
   * @param url          The base websocket URL.
   * @param canUseHeaders `true` when a `webSocketFactory` that supports
   *                       custom headers is available.
   * @returns An object with the (possibly modified) URL and optional headers.
   */
  abstract prepareWebSocket(
    url: string,
    canUseHeaders: boolean,
  ): Promise<{ url: string; headers?: Record<string, string> }>;

  /**
   * Imperatively set or clear the current access token.
   * Subclasses that do not use tokens may no-op.
   */
  abstract setToken(
    token: string | null,
    tokenExpires?: Date | number | null,
  ): void;

  /**
   * Ensure the auth layer is ready (e.g. token refreshed if needed).
   * Called before every HTTP request and before opening a websocket.
   */
  abstract ensureReady(): Promise<void>;

  /** Attach a profile and optional config manager for refresh persistence. */
  attachProfile(
    profile: AuthProfile,
    configManager?: AuthProfileStore,
  ): void {
    this.profile = profile;
    if (configManager) {
      this.configManager = configManager;
    }
  }
}
