import type { RestClient } from "../http/rest-client";
import type {
  Channel,
  CreateChannelRequest,
  DataSeries,
  PutChannelRequest,
} from "../types/openapi";
import { resolveAgentArgs, resolveChannelArgs } from "./_args";
import type { DooverRequestOptions } from "../client/request-options";

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

  listChannels(agentId: string, options?: ListChannelsOptions): Promise<Channel[]>;
  listChannels(agentId: string, requestOptions: DooverRequestOptions): Promise<Channel[]>;
  listChannels(agentId: string, options: ListChannelsOptions, requestOptions: DooverRequestOptions): Promise<Channel[]>;
  listChannels(identifier: { agentId: string }, options?: ListChannelsOptions): Promise<Channel[]>;
  listChannels(identifier: { agentId: string }, requestOptions: DooverRequestOptions): Promise<Channel[]>;
  listChannels(identifier: { agentId: string }, options: ListChannelsOptions, requestOptions: DooverRequestOptions): Promise<Channel[]>;
  listChannels(...args: unknown[]): Promise<Channel[]> {
    const { agentId, options } = resolveAgentArgs<ListChannelsOptions>(args);
    return this._listChannels(agentId, options);
  }
  private _listChannels(agentId: string, options?: ListChannelsOptions) {
    return this.rest.get<Channel[]>(`/agents/${agentId}/channels`, options);
  }

  getChannel(agentId: string, channelName: string, options?: GetChannelOptions): Promise<Channel>;
  getChannel(agentId: string, channelName: string, requestOptions: DooverRequestOptions): Promise<Channel>;
  getChannel(agentId: string, channelName: string, options: GetChannelOptions, requestOptions: DooverRequestOptions): Promise<Channel>;
  getChannel(
    identifier: { agentId: string; channelName: string },
    options?: GetChannelOptions,
  ): Promise<Channel>;
  getChannel(
    identifier: { agentId: string; channelName: string },
    requestOptions: DooverRequestOptions,
  ): Promise<Channel>;
  getChannel(
    identifier: { agentId: string; channelName: string },
    options: GetChannelOptions,
    requestOptions: DooverRequestOptions,
  ): Promise<Channel>;
  getChannel(...args: unknown[]): Promise<Channel> {
    const { agentId, channelName, options } = resolveChannelArgs<GetChannelOptions>(args);
    return this._getChannel(agentId, channelName, options);
  }
  private _getChannel(agentId: string, channelName: string, options?: GetChannelOptions) {
    return this.rest.get<Channel>(
      `/agents/${agentId}/channels/${channelName}`,
      options,
    );
  }

  createChannel(
    agentId: string,
    channelName: string,
    body: CreateChannelRequest,
  ): Promise<{ id: string }>;
  createChannel(
    identifier: { agentId: string; channelName: string },
    body: CreateChannelRequest,
  ): Promise<{ id: string }>;
  createChannel(...args: unknown[]): Promise<{ id: string }> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, body] = args as [string, string, CreateChannelRequest];
      return this._createChannel(agentId, channelName, body);
    }
    const id = args[0] as { agentId: string; channelName: string };
    const body = args[1] as CreateChannelRequest;
    return this._createChannel(id.agentId, id.channelName, body);
  }
  private _createChannel(agentId: string, channelName: string, body: CreateChannelRequest) {
    return this.rest.post<{ id: string }>(
      `/agents/${agentId}/channels/${channelName}`,
      body,
    );
  }

  putChannel(
    agentId: string,
    channelName: string,
    body: PutChannelRequest,
  ): Promise<Channel>;
  putChannel(
    identifier: { agentId: string; channelName: string },
    body: PutChannelRequest,
  ): Promise<Channel>;
  putChannel(...args: unknown[]): Promise<Channel> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, body] = args as [string, string, PutChannelRequest];
      return this._putChannel(agentId, channelName, body);
    }
    const id = args[0] as { agentId: string; channelName: string };
    const body = args[1] as PutChannelRequest;
    return this._putChannel(id.agentId, id.channelName, body);
  }
  private _putChannel(agentId: string, channelName: string, body: PutChannelRequest) {
    return this.rest.put<Channel>(
      `/agents/${agentId}/channels/${channelName}`,
      body,
    );
  }

  archiveChannel(agentId: string, channelName: string): Promise<unknown>;
  archiveChannel(identifier: { agentId: string; channelName: string }): Promise<unknown>;
  archiveChannel(...args: unknown[]): Promise<unknown> {
    const { agentId, channelName } = resolveChannelArgs<undefined>(args);
    return this._archiveChannel(agentId, channelName);
  }
  private _archiveChannel(agentId: string, channelName: string) {
    return this.rest.post<unknown>(
      `/agents/${agentId}/channels/${channelName}/archive`,
      {},
    );
  }

  unarchiveChannel(agentId: string, channelName: string): Promise<unknown>;
  unarchiveChannel(identifier: { agentId: string; channelName: string }): Promise<unknown>;
  unarchiveChannel(...args: unknown[]): Promise<unknown> {
    const { agentId, channelName } = resolveChannelArgs<undefined>(args);
    return this._unarchiveChannel(agentId, channelName);
  }
  private _unarchiveChannel(agentId: string, channelName: string) {
    return this.rest.post<unknown>(
      `/agents/${agentId}/channels/${channelName}/unarchive`,
      {},
    );
  }

  listDataSeries(agentId: string, params: DataSeriesParams): Promise<DataSeries>;
  listDataSeries(identifier: { agentId: string }, params: DataSeriesParams): Promise<DataSeries>;
  listDataSeries(...args: unknown[]): Promise<DataSeries> {
    const { agentId, options } = resolveAgentArgs<DataSeriesParams>(args);
    return this._listDataSeries(agentId, options as DataSeriesParams);
  }
  private _listDataSeries(agentId: string, params: DataSeriesParams) {
    return this.rest.get<DataSeries>(`/agents/${agentId}/data_series`, params);
  }
}
