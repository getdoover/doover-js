import type { RestClient } from "../http/rest-client";
import type { Aggregate } from "../types/openapi";

export interface AggregateMutationParams {
  suppress_response?: boolean;
  clear_attachments?: boolean;
  log_update?: boolean;
}

export class AggregatesApi {
  constructor(private readonly rest: RestClient) {}

  getAggregate(agentId: string, channelName: string) {
    return this.rest.get<Aggregate>(
      `/agents/${agentId}/channels/${channelName}/aggregate`,
    );
  }

  putAggregate(
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
  ) {
    return this.rest.patch<Aggregate>(
      `/agents/${agentId}/channels/${channelName}/aggregate`,
      body,
      params,
    );
  }

  getAggregateAttachment(agentId: string, channelName: string, attachmentId: string) {
    return this.rest.get<Blob>(
      `/agents/${agentId}/channels/${channelName}/aggregate/attachments/${attachmentId}`,
    );
  }
}
