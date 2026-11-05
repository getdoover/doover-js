import type { KeyPolicy } from "../apis/agents-api.js";

/**
 * What a check is about, for {@link policyAllows}: the action, and where it
 * acts. A device or user is `agent`; a channel is `agent` plus `channel`; a
 * control object is `kind` and `id` (e.g. `"application"`, `"42"`). `org`
 * and `groups` (the resource's group and its ancestors) let `org:` and
 * `group:` statements match.
 */
export interface PolicyRequest {
  action: string;
  agent?: string;
  channel?: string;
  kind?: string;
  id?: string;
  org?: string;
  groups?: string[];
}

const INTERNAL = ":internal.";
// Only a statement naming one of these exactly reaches it.
const RESERVED_CHANNELS = new Set(["tunnels", "dv-audit", "dv-registry"]);

type Statement = KeyPolicy["statements"][number];

function globMatches(pattern: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  return pattern.endsWith("*")
    ? value.startsWith(pattern.slice(0, -1))
    : pattern === value;
}

/** At most one `*`, matching any run of characters. A wildcard allows an
 * internal action only when it spells out `internal.`; a deny covers it. */
function actionMatches(
  pattern: string,
  action: string,
  effect: Statement["effect"],
): boolean {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === action;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    action.length >= prefix.length + suffix.length &&
    action.startsWith(prefix) &&
    action.endsWith(suffix) &&
    (effect === "deny" ||
      !action.includes(INTERNAL) ||
      prefix.includes(INTERNAL))
  );
}

function childOf(pattern: string): [string, string] | null {
  // agent:{id}/channel:{name}
  const slash = pattern.indexOf("/");
  if (slash < 0) return null;
  const agentPart = pattern.slice(0, slash);
  const childPart = pattern.slice(slash + 1);
  if (!agentPart.startsWith("agent:") || !childPart.startsWith("channel:")) {
    return null;
  }
  return [agentPart.slice("agent:".length), childPart.slice("channel:".length)];
}

function resourceMatches(pattern: string, req: PolicyRequest): boolean {
  const child = childOf(pattern);
  if (req.channel !== undefined && RESERVED_CHANNELS.has(req.channel)) {
    // Never covered by a broader grant: only a pattern naming it exactly.
    return (
      child !== null &&
      child[1] === req.channel &&
      globMatches(child[0], req.agent)
    );
  }
  if (pattern === "*") return true;
  if (child) {
    return (
      req.channel !== undefined &&
      globMatches(child[0], req.agent) &&
      globMatches(child[1], req.channel)
    );
  }
  const colon = pattern.indexOf(":");
  if (colon < 0) return false;
  const kind = pattern.slice(0, colon);
  const value = pattern.slice(colon + 1);
  if (kind === "org") return globMatches(value, req.org);
  if (kind === "group") {
    return (req.groups ?? []).some((g) => globMatches(value, g));
  }
  if (kind === "agent") return globMatches(value, req.agent);
  return kind === req.kind && globMatches(value, req.id);
}

/**
 * Whether `policy` allows `req`, by the rules doover-data and doover-control
 * enforce: a matching deny wins, else any matching allow. A statement with
 * no resources applies everywhere. Conditions (source IP, transport) can't
 * be known here and are taken as met: this is for what a page offers, and
 * the API still decides.
 */
export function policyAllows(
  policy: KeyPolicy | null | undefined,
  req: PolicyRequest,
): boolean {
  let allowed = false;
  for (const st of policy?.statements ?? []) {
    if (!st.actions.some((a) => actionMatches(a, req.action, st.effect))) {
      continue;
    }
    const resources = st.resources?.length ? st.resources : ["*"];
    if (!resources.some((r) => resourceMatches(r, req))) continue;
    if (st.effect === "deny") return false;
    allowed = true;
  }
  return allowed;
}
