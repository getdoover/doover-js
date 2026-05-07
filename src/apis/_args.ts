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
    return {
      agentId: args[0],
      channelName: args[1] as string,
      options: args[2] as TOptions | undefined,
    };
  }
  const id = args[0] as ChannelIdentifierLike;
  return {
    agentId: id.agentId,
    channelName: id.channelName,
    options: args[1] as TOptions | undefined,
  };
}

export function resolveAgentArgs<TOptions>(
  args: unknown[],
): { agentId: string; options?: TOptions } {
  if (typeof args[0] === "string") {
    return { agentId: args[0], options: args[1] as TOptions | undefined };
  }
  const id = args[0] as AgentIdentifierLike;
  return { agentId: id.agentId, options: args[1] as TOptions | undefined };
}
