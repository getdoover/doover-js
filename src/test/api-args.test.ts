import { expect } from "chai";
import { resolveChannelArgs, resolveAgentArgs } from "../apis/_args";

describe("resolveChannelArgs", () => {
  it("parses positional (agentId, channelName)", () => {
    const result = resolveChannelArgs<{ x: number }>(["a1", "c1"]);
    expect(result).to.deep.equal({ agentId: "a1", channelName: "c1", options: undefined });
  });

  it("parses positional with options", () => {
    const result = resolveChannelArgs<{ x: number }>(["a1", "c1", { x: 7 }]);
    expect(result).to.deep.equal({ agentId: "a1", channelName: "c1", options: { x: 7 } });
  });

  it("parses identifier object", () => {
    const result = resolveChannelArgs<{ x: number }>([
      { agentId: "a1", channelName: "c1" },
    ]);
    expect(result).to.deep.equal({ agentId: "a1", channelName: "c1", options: undefined });
  });

  it("parses identifier object with options", () => {
    const result = resolveChannelArgs<{ x: number }>([
      { agentId: "a1", channelName: "c1" },
      { x: 7 },
    ]);
    expect(result).to.deep.equal({ agentId: "a1", channelName: "c1", options: { x: 7 } });
  });
});

describe("resolveAgentArgs", () => {
  it("parses positional agentId", () => {
    const result = resolveAgentArgs<{ archived: boolean }>(["a1"]);
    expect(result).to.deep.equal({ agentId: "a1", options: undefined });
  });

  it("parses positional with options", () => {
    const result = resolveAgentArgs<{ archived: boolean }>(["a1", { archived: true }]);
    expect(result).to.deep.equal({ agentId: "a1", options: { archived: true } });
  });

  it("parses identifier object", () => {
    const result = resolveAgentArgs<{ archived: boolean }>([{ agentId: "a1" }]);
    expect(result).to.deep.equal({ agentId: "a1", options: undefined });
  });

  it("parses identifier object with options", () => {
    const result = resolveAgentArgs<{ archived: boolean }>([
      { agentId: "a1" },
      { archived: true },
    ]);
    expect(result).to.deep.equal({ agentId: "a1", options: { archived: true } });
  });
});
