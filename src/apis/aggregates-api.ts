import type { RestClient } from "../http/rest-client";
import type { Aggregate } from "../types/openapi";
import { resolveChannelArgs } from "./_args";
import type { DooverRequestOptions } from "../client/request-options";
import {
  chunkBatchItems,
  mergeBatchResponses,
  type BatchAggregateResponse,
  type BatchAggregateUpdateItem,
} from "../types/batch";

export interface AggregateMutationParams {
  suppress_response?: boolean;
  clear_attachments?: boolean;
  log_update?: boolean;
}

export class AggregatesApi {
  constructor(private readonly rest: RestClient) {}

  /**
   * Merge-patch aggregates across many agents and channels in one request.
   *
   * Replaces N single-agent PATCHes with one round trip, which is the point:
   * it removes the per-request HTTP, auth, routing and tracing overhead, and
   * shrinks synchronised write bursts. It does *not* reduce DynamoDB writes —
   * the server still issues one `UpdateItem` per aggregate, capped at four
   * concurrently — so callers should still coalesce on the client rather than
   * relying on this to absorb a storm.
   *
   * Batches over {@link MAX_BATCH_ITEMS} are split automatically and the
   * responses merged, so a caller can pass an arbitrarily long list. An empty
   * list resolves to an empty response without issuing a request.
   *
   * Partial success is normal: inspect `items` and retry only the entries
   * whose `success` is false. Successful entries are never rolled back.
   */
  batchPatchAggregates(items: BatchAggregateUpdateItem[]): Promise<BatchAggregateResponse>;
  batchPatchAggregates(
    items: BatchAggregateUpdateItem[],
    requestOptions: DooverRequestOptions,
  ): Promise<BatchAggregateResponse>;
  batchPatchAggregates(...args: unknown[]): Promise<BatchAggregateResponse> {
    return this._batchPatchAggregates(args[0] as BatchAggregateUpdateItem[]);
  }
  private async _batchPatchAggregates(
    items: BatchAggregateUpdateItem[],
  ): Promise<BatchAggregateResponse> {
    if (items.length === 0) {
      return { items: [], count: 0, succeeded: 0, failed: 0 };
    }
    const responses: BatchAggregateResponse[] = [];
    // Sequential: the point of batching is to stop hammering the write path,
    // so firing every chunk at once would defeat it.
    for (const chunk of chunkBatchItems(items)) {
      responses.push(
        await this.rest.patch<BatchAggregateResponse>("/agents/aggregates", {
          items: chunk,
        }),
      );
    }
    return mergeBatchResponses(responses);
  }

  getAggregate(agentId: string, channelName: string): Promise<Aggregate>;
  getAggregate(agentId: string, channelName: string, requestOptions: DooverRequestOptions): Promise<Aggregate>;
  getAggregate(identifier: { agentId: string; channelName: string }): Promise<Aggregate>;
  getAggregate(identifier: { agentId: string; channelName: string }, requestOptions: DooverRequestOptions): Promise<Aggregate>;
  getAggregate(...args: unknown[]): Promise<Aggregate> {
    const { agentId, channelName } = resolveChannelArgs<undefined>(args);
    return this._getAggregate(agentId, channelName);
  }
  private _getAggregate(agentId: string, channelName: string) {
    return this.rest.get<Aggregate>(
      `/agents/${agentId}/channels/${channelName}/aggregate`,
    );
  }

  putAggregate(
    agentId: string,
    channelName: string,
    body: Record<string, unknown> | FormData,
    params?: AggregateMutationParams,
  ): Promise<Aggregate>;
  putAggregate(
    identifier: { agentId: string; channelName: string },
    body: Record<string, unknown> | FormData,
    params?: AggregateMutationParams,
  ): Promise<Aggregate>;
  putAggregate(...args: unknown[]): Promise<Aggregate> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, body, params] = args as [
        string, string, Record<string, unknown> | FormData, AggregateMutationParams | undefined,
      ];
      return this._putAggregate(agentId, channelName, body, params);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._putAggregate(
      id.agentId,
      id.channelName,
      args[1] as Record<string, unknown> | FormData,
      args[2] as AggregateMutationParams | undefined,
    );
  }
  private _putAggregate(
    agentId: string,
    channelName: string,
    body: Record<string, unknown> | FormData,
    params?: AggregateMutationParams,
  ) {
    return this.rest.put<Aggregate>(
      `/agents/${agentId}/channels/${channelName}/aggregate`,
      body,
      params,
    );
  }

  patchAggregate(
    agentId: string,
    channelName: string,
    body: Record<string, unknown> | FormData,
    params?: AggregateMutationParams,
  ): Promise<Aggregate>;
  patchAggregate(
    identifier: { agentId: string; channelName: string },
    body: Record<string, unknown> | FormData,
    params?: AggregateMutationParams,
  ): Promise<Aggregate>;
  patchAggregate(...args: unknown[]): Promise<Aggregate> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, body, params] = args as [
        string, string, Record<string, unknown> | FormData, AggregateMutationParams | undefined,
      ];
      return this._patchAggregate(agentId, channelName, body, params);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._patchAggregate(
      id.agentId,
      id.channelName,
      args[1] as Record<string, unknown> | FormData,
      args[2] as AggregateMutationParams | undefined,
    );
  }
  private _patchAggregate(
    agentId: string,
    channelName: string,
    body: Record<string, unknown> | FormData,
    params?: AggregateMutationParams,
  ) {
    return this.rest.patch<Aggregate>(
      `/agents/${agentId}/channels/${channelName}/aggregate`,
      body,
      params,
    );
  }

  getAggregateAttachment(
    agentId: string,
    channelName: string,
    attachmentId: string,
  ): Promise<Blob>;
  getAggregateAttachment(
    agentId: string,
    channelName: string,
    attachmentId: string,
    requestOptions: DooverRequestOptions,
  ): Promise<Blob>;
  getAggregateAttachment(
    identifier: { agentId: string; channelName: string },
    attachmentId: string,
  ): Promise<Blob>;
  getAggregateAttachment(
    identifier: { agentId: string; channelName: string },
    attachmentId: string,
    requestOptions: DooverRequestOptions,
  ): Promise<Blob>;
  getAggregateAttachment(...args: unknown[]): Promise<Blob> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, attachmentId] = args as [string, string, string];
      return this._getAggregateAttachment(agentId, channelName, attachmentId);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._getAggregateAttachment(id.agentId, id.channelName, args[1] as string);
  }
  private _getAggregateAttachment(
    agentId: string,
    channelName: string,
    attachmentId: string,
  ) {
    return this.rest.get<Blob>(
      `/agents/${agentId}/channels/${channelName}/aggregate/attachments/${attachmentId}`,
    );
  }
}
