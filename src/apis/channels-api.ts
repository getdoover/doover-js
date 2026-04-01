import type { RestClient } from "../http/rest-client";
import type {
  Channel,
  CreateChannelRequest,
  DataSeries,
  PutChannelRequest,
} from "../types/openapi";

export interface ListChannelsOptions {
  include_aggregate?: boolean;
  include_daily_summaries?: boolean;
  include_archived?: boolean;
}

export interface GetChannelOptions {
  include_aggregate?: boolean;
}

export interface DataSeriesParams {
  before?: string;
  after?: string;
  limit?: number;
  field_name: string[];
}

export class ChannelsApi {
  constructor(private readonly rest: RestClient) {}

  listChannels(agentId: string, options?: ListChannelsOptions) {
    return this.rest.get<Channel[]>(`/agents/${agentId}/channels`, options);
  }

  getChannel(agentId: string, channelName: string, options?: GetChannelOptions) {
    return this.rest.get<Channel>(
      `/agents/${agentId}/channels/${channelName}`,
      options,
    );
  }

  createChannel(agentId: string, channelName: string, body: CreateChannelRequest) {
    return this.rest.post<{ id: string }>(
      `/agents/${agentId}/channels/${channelName}`,
      body,
    );
  }

  putChannel(agentId: string, channelName: string, body: PutChannelRequest) {
    return this.rest.put<Channel>(
      `/agents/${agentId}/channels/${channelName}`,
      body,
    );
  }

  listDataSeries(agentId: string, params: DataSeriesParams) {
    return this.rest.get<DataSeries>(`/agents/${agentId}/data_series`, params);
  }
}
