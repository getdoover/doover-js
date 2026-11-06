import type { KeyPolicy } from "../apis/agents-api.js";

interface PolicyRequest {
  action: string;
  agent?: string;
  channel?: string;
  org?: string;
  /** The resource's group and its ancestors. */
  groups?: string[];
}

const RESERVED_CHANNELS = new Set(["tunnels", "dv-audit", "dv-registry"]);

function globMatches(pattern: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  return pattern.endsWith("*")
    ? value.startsWith(pattern.slice(0, -1))
    : pattern === value;
}

function actionMatches(pattern: string, action: string, deny: boolean) {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === action;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return (
    action.length >= prefix.length + suffix.length &&
    action.startsWith(prefix) &&
    action.endsWith(suffix) &&
    // An allow wildcard reaches internal actions only by spelling them out.
    (deny || !action.includes(":internal.") || prefix.includes(":internal."))
  );
}

function resourceMatches(pattern: string, req: PolicyRequest): boolean {
  const [agentPart, childPart] = pattern.split("/", 2);
  if (req.channel !== undefined && RESERVED_CHANNELS.has(req.channel)) {
    return (
      childPart === `channel:${req.channel}` &&
      globMatches(agentPart.slice("agent:".length), req.agent)
    );
  }
  if (pattern === "*") return true;
  const [kind, value] = [
    agentPart.slice(0, agentPart.indexOf(":")),
    agentPart.slice(agentPart.indexOf(":") + 1),
  ];
  if (childPart !== undefined) {
    return (
      kind === "agent" &&
      childPart.startsWith("channel:") &&
      globMatches(value, req.agent) &&
      globMatches(childPart.slice("channel:".length), req.channel)
    );
  }
  if (kind === "org") return globMatches(value, req.org);
  if (kind === "group")
    return (req.groups ?? []).some((g) => globMatches(value, g));
  return kind === "agent" && globMatches(value, req.agent);
}

/**
 * Whether `policy` allows `req`, as doover-data decides it: a matching deny
 * wins. Conditions are taken as met; the API still decides.
 */
export function policyAllows(
  policy: KeyPolicy | null | undefined,
  req: PolicyRequest,
): boolean {
  let allowed = false;
  for (const st of policy?.statements ?? []) {
    const deny = st.effect === "deny";
    if (!st.actions.some((a) => actionMatches(a, req.action, deny))) continue;
    const resources = st.resources?.length ? st.resources : ["*"];
    if (!resources.some((r) => resourceMatches(r, req))) continue;
    if (deny) return false;
    allowed = true;
  }
  return allowed;
}
