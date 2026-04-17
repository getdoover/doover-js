/**
 * Browser-safe value object representing a single Doover auth profile.
 *
 * Property names use camelCase JS conventions. The static helpers `parse` and
 * `dump` translate to/from the on-disk format shared with pydoover.
 */
export interface AuthProfileData {
  profile?: string;
  token?: string | null;
  tokenExpires?: string | null;
  agentId?: string | null;
  controlBaseUrl?: string | null;
  dataBaseUrl?: string | null;
  refreshToken?: string | null;
  refreshTokenId?: string | null;
  authServerUrl?: string | null;
  authServerClientId?: string | null;
}

/** On-disk key → JS property mapping (pydoover reduced-format Doover2). */
const DISK_KEY_MAP: Record<string, keyof AuthProfileData> = {
  TOKEN: "token",
  TOKEN_EXPIRES: "tokenExpires",
  AGENT_ID: "agentId",
  BASE_URL: "controlBaseUrl",
  BASE_DATA_URL: "dataBaseUrl",
  REFRESH_TOKEN: "refreshToken",
  REFRESH_TOKEN_ID: "refreshTokenId",
  AUTH_SERVER_URL: "authServerUrl",
  AUTH_SERVER_CLIENT_ID: "authServerClientId",
};

/** JS property → on-disk key mapping. */
const JS_KEY_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(DISK_KEY_MAP).map(([disk, js]) => [js, disk]),
);

export class AuthProfile {
  profile: string;
  token: string | null;
  tokenExpires: string | null;
  agentId: string | null;
  controlBaseUrl: string | null;
  dataBaseUrl: string | null;
  refreshToken: string | null;
  refreshTokenId: string | null;
  authServerUrl: string | null;
  authServerClientId: string | null;

  constructor(data: AuthProfileData & { profile: string }) {
    this.profile = data.profile;
    this.token = data.token ?? null;
    this.tokenExpires = data.tokenExpires ?? null;
    this.agentId = data.agentId ?? null;
    this.controlBaseUrl = data.controlBaseUrl ?? null;
    this.dataBaseUrl = data.dataBaseUrl ?? null;
    this.refreshToken = data.refreshToken ?? null;
    this.refreshTokenId = data.refreshTokenId ?? null;
    this.authServerUrl = data.authServerUrl ?? null;
    this.authServerClientId = data.authServerClientId ?? null;
  }

  /**
   * Parse a block of lines (excluding the `[profile=...]` header) into an
   * `AuthProfile`. The profile name must be provided separately.
   */
  static parse(profileName: string, lines: string[]): AuthProfile {
    const data: AuthProfileData = { profile: profileName };
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      const jsProp = DISK_KEY_MAP[key];
      if (jsProp) {
        (data as Record<string, string | null>)[jsProp] = value || null;
      }
    }
    return new AuthProfile(data as AuthProfileData & { profile: string });
  }

  /**
   * Serialise to the on-disk reduced format (without the `[profile=...]`
   * header line, which the caller is responsible for).
   */
  dump(): string {
    const lines: string[] = [];
    for (const jsProp of Object.keys(JS_KEY_MAP)) {
      const value = (this as unknown as Record<string, string | null>)[jsProp];
      if (value !== null && value !== undefined) {
        lines.push(`${JS_KEY_MAP[jsProp]}=${value}`);
      }
    }
    return lines.join("\n");
  }

  /** Full block including the header line. */
  dumpBlock(): string {
    return `[profile=${this.profile}]\n${this.dump()}`;
  }
}
