import { expect } from "chai";
import { ethers } from "hardhat";

describe("MockAgentID (test helper)", () => {
  it("mirrors the real registry read surface", async () => {
    const [a, b] = await ethers.getSigners();
    const m = await ethers.deployContract("MockAgentID");
    expect(await m.balanceOf(a.address)).to.equal(0n);
    expect(await m.handleOf(a.address)).to.equal("");
    await m.connect(a).register("neo");
    expect(await m.balanceOf(a.address)).to.equal(1n);
    expect(await m.handleOf(a.address)).to.equal("neo");
    expect(await m.ownerOfHandle("neo")).to.equal(a.address);
    expect(await m.ownerOf(BigInt(ethers.id("neo")))).to.equal(a.address);
    await expect(m.connect(a).register("neo2")).to.be.revertedWithCustomError(m, "AlreadyHasAgentId");
    await expect(m.connect(b).register("neo")).to.be.revertedWithCustomError(m, "HandleTaken");
    await expect(m.connect(b).register("")).to.be.revertedWithCustomError(m, "InvalidHandle");
    await expect(m.connect(b).revoke()).to.be.revertedWithCustomError(m, "InvalidHandle");
    await m.connect(a).revoke();
    expect(await m.balanceOf(a.address)).to.equal(0n);
  });
});
