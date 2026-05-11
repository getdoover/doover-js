import { expect } from "chai";
import { describe, it } from "mocha";

import * as doover from "../index";

describe("public exports (Phase 1)", () => {
  it("exports the new capability/contract symbols", () => {
    expect(doover.ALL_CAPABILITIES).to.be.an("array");
    expect(doover.UnsupportedCapabilityError).to.be.a("function");
    expect(doover.AmbiguousWriteError).to.be.a("function");
  });
});
