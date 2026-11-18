import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll } from "./fixtures";

describe("AtlasIdentity", () => {
  it("lets an Agent ID holder prove a challenge and emits the handle", async () => {
    const { identity, alice } = await loadFixture(deployAll);
    const ch = ethers.keccak256(ethers.toUtf8Bytes("atlas-login:abc"));
    await expect(identity.connect(alice).prove(ch))
      .to.emit(identity, "IdentityProven")
      .withArgs(alice.address, ch, "alice", 1n, (v: bigint) => v > 0n);
    expect(await identity.challengeUsedBy(ch)).to.equal(alice.address);
    expect(await identity.proofCount(alice.address)).to.equal(1n);
  });

  it("rejects callers without an Agent ID", async () => {
    const { identity, outsider } = await loadFixture(deployAll);
    const ch = ethers.keccak256(ethers.toUtf8Bytes("x"));
    await expect(identity.connect(outsider).prove(ch))
      .to.be.revertedWithCustomError(identity, "NotAgentIdHolder")
      .withArgs(outsider.address);
  });

  it("rejects challenge reuse (replay) even by another holder", async () => {
    const { identity, alice, bob } = await loadFixture(deployAll);
    const ch = ethers.keccak256(ethers.toUtf8Bytes("once"));
    await identity.connect(alice).prove(ch);
    await expect(identity.connect(alice).prove(ch)).to.be.revertedWithCustomError(identity, "ChallengeAlreadyUsed");
    await expect(identity.connect(bob).prove(ch)).to.be.revertedWithCustomError(identity, "ChallengeAlreadyUsed");
  });

  it("rejects the zero challenge", async () => {
    const { identity, alice } = await loadFixture(deployAll);
    await expect(identity.connect(alice).prove(ethers.ZeroHash)).to.be.revertedWithCustomError(identity, "EmptyChallenge");
  });

  it("loses access immediately when the Agent ID is revoked", async () => {
    const { identity, agent, alice } = await loadFixture(deployAll);
    await agent.connect(alice).revoke();
    await expect(identity.connect(alice).prove(ethers.keccak256("0x01"))).to.be.revertedWithCustomError(
      identity,
      "NotAgentIdHolder",
    );
  });

  it("refuses a zero registry address", async () => {
    const F = await ethers.getContractFactory("AtlasIdentity");
    await expect(F.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(F, "ZeroAddress");
  });
});
