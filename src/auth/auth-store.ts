import type { AuthProfile } from "./auth-profile";

/**
 * Structural interface for profile stores accepted by auth classes.
 * Implementations may be backed by files (ConfigManager in the Node subpath)
 * or by in-memory stores for testing.
 */
export interface AuthProfileStore {
  currentProfile: string | null;
  current: AuthProfile | null;
  get(profileName: string): AuthProfile | undefined;
  create(entry: AuthProfile): void;
  delete(profileName: string): void;
  write(): void;
}
