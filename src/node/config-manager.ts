import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { AuthProfile } from "../auth/auth-profile";
import type { AuthProfileStore } from "../auth/auth-store";
import { DooverAuthError } from "../auth/errors";

/**
 * File-backed profile store compatible with pydoover's config format.
 *
 * Reads `~/.doover/config` (or a custom path) synchronously on construction,
 * matching Python's eager-read model.
 *
 * Behaviour:
 * - Doover2 `[profile=...]` blocks are parsed into `AuthProfile` entries.
 * - Legacy Doover1 `[...]` blocks and unrecognised raw blocks are preserved
 *   verbatim in their original order and written back unchanged.
 * - `write()` creates the `~/.doover` directory if missing.
 */
export class ConfigManager implements AuthProfileStore {
  currentProfile: string | null = null;
  current: AuthProfile | null = null;

  /** Parsed Doover2 profiles keyed by profile name. */
  private profiles = new Map<string, AuthProfile>();

  /**
   * Ordered list of *blocks* in the file as they were originally read. Each
   * entry is either a `{ type: "managed"; name: string }` reference into
   * `this.profiles`, or a `{ type: "raw"; text: string }` blob that is
   * preserved verbatim.
   */
  private blocks: Array<
    | { type: "managed"; name: string }
    | { type: "raw"; text: string }
  > = [];

  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath =
      configPath ?? path.join(os.homedir(), ".doover", "config");
    this.read();
  }

  // ------------------------------------------------------------------
  // AuthProfileStore interface
  // ------------------------------------------------------------------

  get(profileName: string): AuthProfile | undefined {
    return this.profiles.get(profileName);
  }

  create(entry: AuthProfile): void {
    const existing = this.profiles.has(entry.profile);
    this.profiles.set(entry.profile, entry);
    if (!existing) {
      this.blocks.push({ type: "managed", name: entry.profile });
    }
  }

  delete(profileName: string): void {
    this.profiles.delete(profileName);
    this.blocks = this.blocks.filter(
      (b) => !(b.type === "managed" && b.name === profileName),
    );
    if (this.currentProfile === profileName) {
      this.currentProfile = null;
      this.current = null;
    }
  }

  write(): void {
    const dir = path.dirname(this.configPath);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new DooverAuthError(
        `Failed to create config directory '${dir}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const sections: string[] = [];
    for (const block of this.blocks) {
      if (block.type === "raw") {
        sections.push(block.text);
      } else {
        const profile = this.profiles.get(block.name);
        if (profile) {
          sections.push(profile.dumpBlock());
        }
      }
    }

    try {
      fs.writeFileSync(this.configPath, sections.join("\n\n") + "\n", "utf-8");
    } catch (err) {
      throw new DooverAuthError(
        `Failed to write config file '${this.configPath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ------------------------------------------------------------------
  // Internal parsing
  // ------------------------------------------------------------------

  private read(): void {
    let content: string;
    try {
      content = fs.readFileSync(this.configPath, "utf-8");
    } catch {
      // File does not exist — start empty.
      return;
    }

    this.profiles.clear();
    this.blocks = [];

    const lines = content.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const line = lines[i]!;
      const profileMatch = line.match(/^\[profile=(.+)\]$/);

      if (profileMatch) {
        // Doover2 managed block
        const profileName = profileMatch[1]!;
        const bodyLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i]!.startsWith("[")) {
          bodyLines.push(lines[i]!);
          i++;
        }
        const profile = AuthProfile.parse(profileName, bodyLines);
        this.profiles.set(profileName, profile);
        this.blocks.push({ type: "managed", name: profileName });
      } else if (line.match(/^\[.+\]$/) && !line.match(/^\[profile=/)) {
        // Legacy Doover1 block — preserve verbatim.
        const rawLines: string[] = [line];
        i++;
        while (i < lines.length && !lines[i]!.startsWith("[")) {
          rawLines.push(lines[i]!);
          i++;
        }
        this.blocks.push({ type: "raw", text: rawLines.join("\n").trimEnd() });
      } else {
        // Stray line outside any block — preserve as raw.
        if (line.trim()) {
          this.blocks.push({ type: "raw", text: line });
        }
        i++;
      }
    }

    // Set default current profile to the first managed profile.
    if (this.profiles.size > 0) {
      const firstName = this.profiles.keys().next().value as string;
      this.currentProfile = firstName;
      this.current = this.profiles.get(firstName)!;
    }
  }
}
