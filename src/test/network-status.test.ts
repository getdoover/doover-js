import { expect } from "chai";
import { describe, it } from "mocha";
import { browserNetworkStatus, createNetworkStatusStore } from "../client/network-status.js";

describe("network status sources", () => {
  it("assumes online without a platform network signal", () => {
    expect(browserNetworkStatus.getSnapshot().online).to.equal(true);
    expect(browserNetworkStatus.getSnapshot()).to.equal(browserNetworkStatus.getSnapshot());
  });

  it("notifies only on changes and releases native subscribers", () => {
    const source = createNetworkStatusStore(true);
    const initial = source.getSnapshot();
    let notifications = 0;
    const unsubscribe = source.subscribe(() => { notifications++; });
    source.setOnline(true);
    expect(source.getSnapshot()).to.equal(initial);
    expect(notifications).to.equal(0);
    source.setOnline(false);
    expect(source.getSnapshot().online).to.equal(false);
    expect(source.getSnapshot()).not.to.equal(initial);
    expect(notifications).to.equal(1);
    unsubscribe();
    unsubscribe();
    source.setOnline(true);
    expect(notifications).to.equal(1);
  });
});
