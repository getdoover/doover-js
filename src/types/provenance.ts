/**
 * Provenance envelope stamped on every datum a `DataClient` returns —
 * describing which client produced it, when, and how (REST request with
 * params/timing, or gateway event with name/receipt time).
 *
 * Purely additive: every data shape gains `__source?: SourceProvenance`.
 * Nothing existing is removed/renamed/modified.
 */
export interface SourceProvenance {
  /** Which DataClient produced this datum. For a stand-alone client this is
   *  its own id; for an item via a MultiplexClient it is the originating
   *  member's id. */
  client: {
    id: string;
    /** "cloud" | "local" | … */
    kind: string;
    label?: string;
    /** Arbitrary client/source metadata (base URL, org id, device id, …). */
    meta?: Record<string, unknown>;
  };
  /** When the client obtained this datum (epoch ms). */
  retrievedAt: number;
  via: SourceProvenanceViaRest | SourceProvenanceViaGateway;
}

export interface SourceProvenanceViaRest {
  transport: "rest";
  /** The DataClient method that produced it, e.g. "messages.listMessages". */
  method: string;
  /** The input the caller passed (agentId, channelName, params, body summary). */
  request: Record<string, unknown>;
  startedAt: number; // epoch ms
  durationMs: number;
  /** HTTP status, when known. */
  status?: number;
}

export interface SourceProvenanceViaGateway {
  transport: "gateway";
  /** The gateway event that carried it, e.g. "messageCreate", "aggregateUpdate". */
  event: string;
  sessionId?: string;
  /** When the event was received (epoch ms). */
  receivedAt: number;
}
