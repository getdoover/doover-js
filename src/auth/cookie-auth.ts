import { DooverAuth } from "./doover-auth";

/**
 * Cookie-based auth — the default browser strategy.
 *
 * Relies on ambient cookies (`credentials: "include"`) and does not add any
 * `Authorization` header. Token refresh is not applicable.
 */
export class CookieAuth extends DooverAuth {
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
    // No-op for cookie auth.
  }

  async ensureReady(): Promise<void> {
    // Nothing to prepare for cookie auth.
  }
}
