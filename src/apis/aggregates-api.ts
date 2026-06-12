import type { RestClient } from "../http/rest-client";
import type { Aggregate } from "../types/openapi";
import { resolveChannelArgs } from "./_args";
import type { DooverRequestOptions } from "../client/request-options";

export interface AggregateMutationParams {
  suppress_response?: boolean;
  clear_attachments?: boolean;
  log_update?: boolean;
}

export class AggregatesApi {
  constructor(private readonly rest: RestClient) {}

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
