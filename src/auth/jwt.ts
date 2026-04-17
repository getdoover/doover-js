/**
 * Decode the `exp` claim from a JWT without verifying the signature.
 * Returns the expiry as a `Date`, or `null` if the token has no `exp` claim
 * or cannot be decoded.
 */
export function decodeTokenExpiry(token: string): Date | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }
    // Base64url → Base64 → decode
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof atob === "function"
        ? atob(base64)
        : Buffer.from(base64, "base64").toString("utf-8");
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") {
      return null;
    }
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}
