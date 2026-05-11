import { expect } from "chai";
import { describe, it } from "mocha";

import { dedupeBy, mergeMessages } from "../client/multiplex-merge";

describe("multiplex merge helpers", () => {
  it("dedupeBy keeps the first occurrence", () => {
    const out = dedupeBy([{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "a", n: 3 }], (x) => x.id);
    expect(out).to.deep.equal([{ id: "a", n: 1 }, { id: "b", n: 2 }]);
  });

  it("mergeMessages: dedup by id, sort to requested order, re-apply limit", () => {
    const a = [{ id: "5" }, { id: "3" }, { id: "1" }];
    const b = [{ id: "4" }, { id: "3" }, { id: "2" }];
    const desc = mergeMessages([a, b] as never, { order: "desc", limit: 4 });
    expect(desc.map((m) => (m as { id: string }).id)).to.deep.equal(["5", "4", "3", "2"]);
    const asc = mergeMessages([a, b] as never, { order: "asc", limit: 3 });
    expect(asc.map((m) => (m as { id: string }).id)).to.deep.equal(["1", "2", "3"]);
  });
});
