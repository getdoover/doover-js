import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";

import {
  ChannelRangeStore,
  getChannelRangeStore,
  resetChannelRangeStores,
} from "../react/messageRangeStore";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import type { MessageStructure } from "../types/common";

/** Frozen so a cursor built twice is the same cursor — real clocks make these flaky. */
const NOW = Date.now();

/** Messages at 1-minute spacing, oldest first, ending `minutesAgo` before NOW. */
function makeMessages(count: number, startMinutesAgo: number): MessageStructure[] {
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(NOW - (startMinutesAgo - i) * 60_000);
    return {
      id: generateSnowflakeIdAtTime(at),
      data: { i },
      attachments: [],
      author_id: "a",
      channel: { agentId: "agent", channelName: "chan" },
      timestamp: at.getTime(),
    } as unknown as MessageStructure;
  });
}

const idAt = (minutesAgo: number) =>
  BigInt(generateSnowflakeIdAtTime(new Date(NOW - minutesAgo * 60_000)));

const ids = (messages: MessageStructure[] | undefined) =>
  (messages ?? []).map((m) => m.id);

describe("ChannelRangeStore", () => {
  let store: ChannelRangeStore;

  beforeEach(() => {
    store = new ChannelRangeStore();
  });

  it("returns undefined for a range it has never seen", () => {
    expect(store.read(idAt(0), 10)).to.equal(undefined);
  });

  it("serves a full page back from cache", () => {
    const page = makeMessages(10, 20);
    store.record({ before: idAt(0), limit: 10, page });

    const read = store.read(idAt(0), 10);
    expect(ids(read)).to.deep.equal(ids(page));
  });

  it("returns messages ascending, matching order:asc", () => {
    const page = makeMessages(5, 20);
    store.record({ before: idAt(0), limit: 5, page });

    const read = store.read(idAt(0), 5)!;
    for (let i = 1; i < read.length; i++) {
      expect(BigInt(read[i].id) > BigInt(read[i - 1].id)).to.equal(true);
    }
  });

  it("serves the NEWEST `limit` older than the cursor, not the first", () => {
    const page = makeMessages(10, 20); // 20..11 minutes ago
    store.record({ before: idAt(0), limit: 10, page });

    const read = store.read(idAt(0), 3);
    expect(ids(read)).to.deep.equal(ids(page.slice(7)));
  });

  it("excludes the cursor message itself (`before` is exclusive)", () => {
    const page = makeMessages(5, 20);
    store.record({ before: idAt(0), limit: 5, page });

    // Only 2 messages sit below page[2], so asking for more would (rightly) be
    // unanswerable — nothing proves what lies below the segment's `lo`.
    const cursor = BigInt(page[2].id);
    const read = store.read(cursor, 2)!;
    expect(read.every((m) => BigInt(m.id) < cursor)).to.equal(true);
    expect(ids(read)).to.deep.equal(ids(page.slice(0, 2)));
  });

  it("will not answer beyond what it has proven", () => {
    const page = makeMessages(10, 20);
    store.record({ before: idAt(0), limit: 10, page });

    // Holds 10, asked for 20, and nothing says the range bottoms out here
    expect(store.read(idAt(0), 20)).to.equal(undefined);
  });

  it("answers short when a short page proved the range bottoms out", () => {
    const page = makeMessages(3, 20);
    store.record({ before: idAt(0), limit: 10, page }); // 3 < 10 => atStart

    const read = store.read(idAt(0), 10);
    expect(ids(read)).to.deep.equal(ids(page));
  });

  it("will not answer a cursor above its proven upper bound", () => {
    const page = makeMessages(10, 20);
    store.record({ before: idAt(10), limit: 10, page });

    // Nothing proves what sits between 10 minutes ago and now
    expect(store.read(idAt(0), 5)).to.equal(undefined);
  });

  it("merges touching ranges so a later read spans both", () => {
    const older = makeMessages(10, 40); // 40..31
    const newer = makeMessages(10, 20); // 20..11

    store.record({ before: idAt(0), limit: 10, page: newer });
    // Paging older: cursor is the oldest we held
    store.record({ before: BigInt(newer[0].id), limit: 10, page: older, at: NOW });

    expect(store.snapshot()).to.have.length(1);
    const read = store.read(idAt(0), 20);
    expect(ids(read)).to.deep.equal([...ids(older), ...ids(newer)]);
  });

  it("merges overlapping ranges without duplicating", () => {
    const page = makeMessages(10, 20);
    store.record({ before: idAt(0), limit: 10, page });
    store.record({ before: idAt(0), limit: 10, page }); // same window again

    expect(store.snapshot()).to.have.length(1);
    expect(ids(store.read(idAt(0), 10))).to.deep.equal(ids(page));
  });

  it("keeps disjoint ranges apart rather than claiming the gap", () => {
    const ancient = makeMessages(5, 500);
    const recent = makeMessages(5, 20);

    store.record({ before: idAt(0), limit: 5, page: recent });
    store.record({ before: idAt(400), limit: 5, page: ancient });

    expect(store.snapshot()).to.have.length(2);
    // The hole between them is not covered, so a span across it must refetch
    expect(store.read(idAt(0), 10)).to.equal(undefined);
  });

  it("serves an anchored read from a range fetched for a different anchor", () => {
    const page = makeMessages(30, 60);
    store.record({ before: idAt(0), limit: 30, page });

    // Jumping to 30 minutes ago costs nothing: already proven
    const read = store.read(idAt(30), 5);
    expect(read).to.not.equal(undefined);
    expect(read!.every((m) => m.timestamp < Date.now() - 30 * 60_000)).to.equal(true);
  });

  it("orders by numeric id, not string (500 sorts before 4000)", () => {
    const short = { id: "500", timestamp: 1 } as unknown as MessageStructure;
    const long = { id: "4000", timestamp: 2 } as unknown as MessageStructure;

    store.record({ before: 5000n, limit: 10, page: [long, short], at: NOW });
    expect(ids(store.read(5000n, 10))).to.deep.equal(["500", "4000"]);
  });

  it("records an empty page as a proven-empty range", () => {
    store.record({ before: idAt(0), limit: 10, page: [] });
    expect(store.read(idAt(0), 10)).to.deep.equal([]);
  });

  describe("live tip", () => {
    it("extends coverage with pushes when proven up to now", () => {
      const page = makeMessages(5, 20);
      store.record({ before: idAt(0), limit: 5, page });

      const [live] = makeMessages(1, -1); // one minute into the future
      store.recordLive(live);

      const read = store.read(BigInt(live.id) + 1n, 6);
      expect(ids(read)).to.deep.equal([...ids(page), live.id]);
    });

    it("ignores pushes for a stale window, which may not be contiguous", () => {
      const page = makeMessages(5, 500);
      // Proven only up to ~8 hours ago, so a push now leaves a hole
      store.record({ before: idAt(480), limit: 5, page });

      const [live] = makeMessages(1, 0);
      store.recordLive(live);

      expect(store.read(BigInt(live.id) + 1n, 6)).to.equal(undefined);
    });

    it("stops extending once the socket drops", () => {
      const page = makeMessages(5, 20);
      store.record({ before: idAt(0), limit: 5, page });

      store.sealTips(); // gateway "close"
      const [live] = makeMessages(1, -1);
      store.recordLive(live);

      // The push is not trusted to prove the range, so the gap must be refetched
      expect(store.read(BigInt(live.id) + 1n, 6)).to.equal(undefined);
    });

    it("does not duplicate a push already fetched", () => {
      const page = makeMessages(5, 20);
      store.record({ before: idAt(0), limit: 5, page });

      store.recordLive(page[4]);
      expect(ids(store.read(idAt(0), 5))).to.deep.equal(ids(page));
    });
  });
});

describe("getChannelRangeStore", () => {
  beforeEach(() => resetChannelRangeStores());

  it("shares one store per stream key", () => {
    expect(getChannelRangeStore("a|c")).to.equal(getChannelRangeStore("a|c"));
  });

  it("keeps different streams apart", () => {
    expect(getChannelRangeStore("a|c")).to.not.equal(getChannelRangeStore("a|d"));
  });
});
