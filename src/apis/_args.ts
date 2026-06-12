import { isDooverRequestOptions } from "../client/request-options";

export interface ChannelIdentifierLike {
  agentId: string;
  channelName: string;
}

export interface AgentIdentifierLike {
  agentId: string;
}

export function resolveChannelArgs<TOptions>(
  args: unknown[],
): { agentId: string; channelName: string; options?: TOptions } {
  if (typeof args[0] === "string") {
    const options = isDooverRequestOptions(args[2]) ? undefined : args[2];
    return {
      agentId: args[0],
      channelName: args[1] as string,
      options: options as TOptions | undefined,
    };
  }
  const id = args[0] as ChannelIdentifierLike;
  const options = isDooverRequestOptions(args[1]) ? undefined : args[1];
  return {
    agentId: id.agentId,
    channelName: id.channelName,
    options: options as TOptions | undefined,
  };
}

export function resolveAgentArgs<TOptions>(
  args: unknown[],
): { agentId: string; options?: TOptions } {
  if (typeof args[0] === "string") {
    const options = isDooverRequestOptions(args[1]) ? undefined : args[1];
    return { agentId: args[0], options: options as TOptions | undefined };
  }
  const id = args[0] as AgentIdentifierLike;
  const options = isDooverRequestOptions(args[1]) ? undefined : args[1];
  return { agentId: id.agentId, options: options as TOptions | undefined };
}
