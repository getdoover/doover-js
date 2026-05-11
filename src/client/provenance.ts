import type {
  SourceProvenance,
  SourceProvenanceViaGateway,
  SourceProvenanceViaRest,
} from "../types/provenance";

export interface ClientIdentity {
  id: string;
  kind: string;
  label?: string;
  meta?: Record<string, unknown>;
}

interface RestContext {
  /** e.g. "messages.listMessages" */
  method: string;
  /** caller inputs (agentId, channelName, params, body summary) */
  request: Record<string, unknown>;
  startedAt: number;
  durationMs: number;
  status?: number;
}

interface GatewayContext {
  event: string;
  sessionId?: string;
}

/** Property names whose (object) value should also be stamped, for the known
 *  gateway envelopes ({ ..., aggregate }, { ..., message }). */
const NESTED_OBJECT_PROPS = ["aggregate", "message"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) return false;
  if (typeof Blob !== "undefined" && v instanceof Blob) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export class ProvenanceStamper {
  constructor(private readonly identity: ClientIdentity) {}

  stampRest<T>(value: T, ctx: RestContext): T {
    const via: SourceProvenanceViaRest = {
      transport: "rest",
      method: ctx.method,
      request: ctx.request,
      startedAt: ctx.startedAt,
      durationMs: ctx.durationMs,
      ...(ctx.status !== undefined ? { status: ctx.status } : {}),
    };
    return this.stampGraph(value, via);
  }

  stampGatewayEvent<T>(value: T, ctx: GatewayContext): T {
    const via: SourceProvenanceViaGateway = {
      transport: "gateway",
      event: ctx.event,
      ...(ctx.sessionId !== undefined ? { sessionId: ctx.sessionId } : {}),
      receivedAt: Date.now(),
    };
    return this.stampGraph(value, via);
  }

  /** Build the full provenance envelope from a `via`. */
  private prov(via: SourceProvenance["via"]): SourceProvenance {
    return { client: this.identity, retrievedAt: Date.now(), via };
  }

  /**
   * Arrays → stamp each plain-object element. Plain objects → set `__source`,
   * then shallow-stamp array-valued props' elements and known nested-object
   * props (`aggregate`, `message`). Everything else (Blob, primitives,
   * undefined, FormData, class instances) → returned unchanged.
   */
  private stampGraph<T>(value: T, via: SourceProvenance["via"]): T {
    const prov = this.prov(via);
    if (Array.isArray(value)) {
      return value.map((el) => (isPlainObject(el) ? { ...el, __source: prov } : el)) as unknown as T;
    }
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = { ...value, __source: prov };
    for (const [k, v] of Object.entries(out)) {
      if (k === "__source") continue;
      if (Array.isArray(v)) {
        out[k] = v.map((el) => (isPlainObject(el) ? { ...el, __source: prov } : el));
      } else if ((NESTED_OBJECT_PROPS as readonly string[]).includes(k) && isPlainObject(v)) {
        out[k] = { ...v, __source: prov };
      }
    }
    return out as unknown as T;
  }
}

/**
 * Returns a Proxy over `api` whose methods, when they return a Promise, stamp
 * the resolved value with `via.method = "<subclientName>.<methodName>"`.
 * Synchronous returns (e.g. `createMultipartPayload`) pass through untouched.
 */
export function wrapSubclient<T extends object>(
  api: T,
  subclientName: string,
  stamper: ProvenanceStamper,
): T {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      const methodName = `${subclientName}.${prop}`;
      return function (...args: unknown[]) {
        const startedAt = Date.now();
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) {
          return out.then((result) =>
            stamper.stampRest(result, {
              method: methodName,
              request: { args: summariseArgs(args) },
              startedAt,
              durationMs: Date.now() - startedAt,
            }),
          );
        }
        return out;
      };
    },
  }) as T;
}

/** Keep `via.request` small: drop FormData/Blob bodies, cap string length. */
function summariseArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof FormData !== "undefined" && a instanceof FormData) return "[FormData]";
    if (typeof Blob !== "undefined" && a instanceof Blob) return "[Blob]";
    if (typeof a === "string" && a.length > 200) return `${a.slice(0, 200)}…`;
    return a;
  });
}
