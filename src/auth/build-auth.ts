import type { AuthProfile } from "./auth-profile";
import type { AuthProfileStore } from "./auth-store";
import { CookieAuth } from "./cookie-auth";
import { DooverAuth } from "./doover-auth";
import { DooverTokenAuth } from "./doover-token-auth";
import { DooverAuthError } from "./errors";

/**
 * Raw auth inputs that can be provided in client configs.
 *
 * If `auth` is provided it is used as-is and raw inputs must not be combined
 * with it. Otherwise these fields are used to build the appropriate auth
 * instance automatically.
 */
export interface AuthConfig {
  auth?: DooverAuth;
  profile?: string | AuthProfile;
  configManager?: AuthProfileStore;
  token?: string | null;
  tokenExpires?: Date | number | null;
  refreshToken?: string | null;
  refreshTokenId?: string | null;
  authServerUrl?: string | null;
  authServerClientId?: string | null;
}

/** Fetch implementation to thread through to DooverTokenAuth. */
interface BuildAuthOptions extends AuthConfig {
  fetchImpl?: typeof fetch;
}

const TOKEN_FIELDS: Array<keyof AuthConfig> = [
  "token",
  "tokenExpires",
  "refreshToken",
  "refreshTokenId",
  "authServerUrl",
  "authServerClientId",
];

/**
 * Build a `DooverAuth` instance from the provided configuration.
 *
 * Rules:
 * 1. If `auth` is provided it is returned as-is.
 * 2. If any token-related field is present, build `DooverTokenAuth`.
 * 3. If `profile` is an `AuthProfile`, use it to seed a `DooverTokenAuth`.
 * 4. If `profile` is a string, look it up via `configManager`.
 * 5. Otherwise fall back to `CookieAuth`.
 */
export function buildAuth(options: BuildAuthOptions): DooverAuth {
  if (options.auth) {
    // Validate mutual exclusivity.
    const hasRaw = TOKEN_FIELDS.some((k) => options[k] !== undefined);
    if (hasRaw || options.profile !== undefined || options.configManager !== undefined) {
      throw new DooverAuthError(
        "Cannot combine 'auth' with raw auth config fields (token, profile, configManager, etc.)",
      );
    }
    return options.auth;
  }

  // Resolve the profile object.
  let resolvedProfile: AuthProfile | null = null;

  if (typeof options.profile === "string") {
    if (!options.configManager) {
      throw new DooverAuthError(
        "A 'configManager' (AuthProfileStore) is required when 'profile' is a string. " +
          "Use the doover-js/node subpath to import ConfigManager, or provide an AuthProfile directly.",
      );
    }
    resolvedProfile = options.configManager.get(options.profile) ?? null;
    if (!resolvedProfile) {
      throw new DooverAuthError(
        `Profile '${options.profile}' not found in the config manager`,
      );
    }
  } else if (options.profile instanceof Object && "profile" in options.profile) {
    // AuthProfile instance
    resolvedProfile = options.profile as AuthProfile;
  }

  // Determine whether we need token auth.
  const hasTokenInput = TOKEN_FIELDS.some((k) => options[k] !== undefined);
  const profileHasToken = resolvedProfile?.token != null;

  if (!hasTokenInput && !profileHasToken) {
    // No token data at all — fall back to cookie auth.
    const auth = new CookieAuth();
    if (resolvedProfile) {
      auth.attachProfile(resolvedProfile, options.configManager);
    }
    return auth;
  }

  // Build DooverTokenAuth with explicit fields overriding profile values.
  const auth = new DooverTokenAuth({
    token: options.token ?? undefined,
    tokenExpires: options.tokenExpires ?? undefined,
    refreshToken: options.refreshToken ?? undefined,
    refreshTokenId: options.refreshTokenId ?? undefined,
    authServerUrl: options.authServerUrl ?? undefined,
    authServerClientId: options.authServerClientId ?? undefined,
    fetchImpl: options.fetchImpl,
  });

  if (resolvedProfile) {
    auth.attachProfile(resolvedProfile, options.configManager);
  }

  return auth;
}
