import { expect } from "chai";
import { describe, it } from "mocha";

import {
  addTimestampToMessage,
  extractSnowflakeId,
  generateSnowflakeIdAtTime,
} from "../utils/snowflake";
import { getIdentifierFromPath } from "../viewer/path-parsing";

describe("snowflake utilities", () => {
  it("generates and extracts timestamps consistently", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const id = generateSnowflakeIdAtTime(date);
    const extracted = extractSnowflakeId(id);

    expect(extracted.timestamp).to.equal(date.getTime());
    expect(id).to.match(/^\d+$/);
  });

  it("floors a pre-epoch time at the oldest addressable id", () => {
    // Ids are unsigned; the API rejects a negative one outright and fails the whole
    // request, so a caller reaching further back than 2025-01-01 gets the epoch.
    expect(generateSnowflakeIdAtTime(new Date("2023-11-18T02:58:19.326Z"))).to.equal(
      "0",
    );
    expect(generateSnowflakeIdAtTime(new Date("2025-01-01T00:00:00.000Z"))).to.equal(
      "0",
    );
    expect(generateSnowflakeIdAtTime(new Date(0))).to.equal("0");
  });

  it("rejects an invalid time rather than emitting a garbage id", () => {
    expect(() => generateSnowflakeIdAtTime(new Date("nonsense"))).to.throw(
      TypeError,
    );
  });

  it("adds an epoch-ms timestamp to messages", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const id = generateSnowflakeIdAtTime(date);

    const message = addTimestampToMessage({
      id,
      author_id: "user",
      channel: { agent_id: "agent", name: "channel" },
      data: {},
      attachments: [],
    });

    expect(message.timestamp).to.equal(date.getTime());
  });
});

describe("path parsing", () => {
  it("parses agent-only paths", () => {
    expect(getIdentifierFromPath("agent-1", new URLSearchParams())).to.deep.equal({
      identifier: {
        agentId: "agent-1",
        channelName: undefined,
      },
    });
  });

  it("parses channel paths with aggregate tails", () => {
    expect(
      getIdentifierFromPath("/agent-1/channel-1/path/to/value", new URLSearchParams()),
    ).to.deep.equal({
      identifier: {
        agentId: "agent-1",
        channelName: "channel-1",
      },
      aggregatePath: "path/to/value",
    });
  });

  it("returns an empty identifier for an empty path", () => {
    expect(getIdentifierFromPath("/", new URLSearchParams())).to.deep.equal({
      identifier: {
        agentId: undefined,
        channelName: undefined,
      },
    });
  });
});
