import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, longTerms, DAY } from "./fixtures";

const SALT = ethers.id("s");
const EVIDENCE = ethers.id("evidence-json");
enum Outcome { None, TargetHit, InvalidationHit, Expired, Ambiguous, Void, Forfeited }

async function withPublished() {
  const f = await loadFixture(deployAll);
  const terms = await longTerms();
  await f.registry.connect(f.alice).publish(terms, SALT, (await time.latest()) + 30 * DAY);
  return { ...f, terms };
}

describe("OutcomeAttestor", () => {
  it("discloses owner-only evaluator management", async () => {
    const { attestor, alice, bob, deployer } = await loadFixture(deployAll);
    await expect(attestor.connect(alice).setEvaluator(bob.address, true)).to.be.revertedWithCustomError(attestor, "OwnableUnauthorizedAccount");
    await expect(attestor.connect(deployer).setEvaluator(bob.address, true)).to.emit(attestor, "EvaluatorSet").withArgs(bob.address, true);
    expect(await attestor.evaluatorCount()).to.equal(2n);
    await attestor.setEvaluator(bob.address, true); // idempotent
    expect(await attestor.evaluatorCount()).to.equal(2n);
    await attestor.setEvaluator(bob.address, false);
    expect(await attestor.evaluatorCount()).to.equal(1n);
    await expect(attestor.setEvaluator(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(attestor, "ZeroAddress");
  });

  it("transfers ownership in two steps", async () => {
    const { attestor, deployer, bob } = await loadFixture(deployAll);
    await attestor.connect(deployer).transferOwnership(bob.address);
    expect(await attestor.owner()).to.equal(deployer.address);
    await attestor.connect(bob).acceptOwnership();
    expect(await attestor.owner()).to.equal(bob.address);
  });

  it("proposes a TargetHit inside the window and finalizes after the dispute window", async () => {
    const { attestor, evaluator, terms } = await withPublished();
    const observed = Number(terms.startTime) + 7200;
    await time.increaseTo(observed + 10);
    await expect(attestor.connect(evaluator).attest(1, Outcome.TargetHit, observed, 1000, EVIDENCE))
      .to.emit(attestor, "OutcomeProposed")
      .withArgs(1n, evaluator.address, Outcome.TargetHit, observed, 1000, EVIDENCE, 1);
    await expect(attestor.finalize(1)).to.be.revertedWithCustomError(attestor, "TooEarly");
    await time.increase(2 * DAY + 1);
    await expect(attestor.finalize(1)).to.emit(attestor, "OutcomeFinalized").withArgs(1n, Outcome.TargetHit);
    const a = await attestor.getAttestation(1);
    expect(a.state).to.equal(3n);
    await expect(attestor.connect(evaluator).attest(1, Outcome.Expired, 0, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "BadState");
  });

  it("guards attestation inputs", async () => {
    const { attestor, evaluator, alice, terms, registry } = await withPublished();
    await expect(attestor.connect(alice).attest(1, Outcome.TargetHit, 0, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "NotEvaluator");
    await expect(attestor.connect(evaluator).attest(1, Outcome.None, 0, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "BadOutcome");
    await expect(attestor.connect(evaluator).attest(1, Outcome.Forfeited, 0, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "BadOutcome");
    await expect(attestor.connect(evaluator).attest(1, Outcome.TargetHit, Number(terms.startTime) - 1, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "ObservationOutOfWindow");
    await expect(attestor.connect(evaluator).attest(1, Outcome.TargetHit, Number(terms.startTime) + 10, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "TooEarly");
    await expect(attestor.connect(evaluator).attest(1, Outcome.Expired, 0, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "TooEarly");
    // unrevealed thesis
    await registry.connect(alice).commit(ethers.id("hidden"), (await time.latest()) + 10 * DAY);
    await expect(attestor.connect(evaluator).attest(2, Outcome.Void, 0, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "NotRevealed");
  });

  it("lets an Agent ID holder dispute, then requires re-attestation (max 3 rounds)", async () => {
    const { attestor, evaluator, bob, outsider, terms } = await withPublished();
    await time.increaseTo(Number(terms.endTime) + 1);
    await attestor.connect(evaluator).attest(1, Outcome.Expired, 0, -150, EVIDENCE);
    await expect(attestor.connect(outsider).dispute(1, ethers.id("r"))).to.be.revertedWithCustomError(attestor, "NotAgentIdHolder");
    await expect(attestor.connect(bob).dispute(1, ethers.id("wrong candle"))).to.emit(attestor, "OutcomeDisputed").withArgs(1n, bob.address, ethers.id("wrong candle"), "bob");
    await expect(attestor.finalize(1)).to.be.revertedWithCustomError(attestor, "BadState");
    await expect(attestor.connect(bob).dispute(1, ethers.ZeroHash)).to.be.revertedWithCustomError(attestor, "BadState");
    await attestor.connect(evaluator).attest(1, Outcome.Ambiguous, 0, 0, EVIDENCE); // round 2
    await attestor.connect(bob).dispute(1, ethers.ZeroHash);
    await attestor.connect(evaluator).attest(1, Outcome.Ambiguous, 0, 0, EVIDENCE); // round 3
    await attestor.connect(bob).dispute(1, ethers.ZeroHash);
    await expect(attestor.connect(evaluator).attest(1, Outcome.Ambiguous, 0, 0, EVIDENCE)).to.be.revertedWithCustomError(attestor, "MaxRounds");
  });

  it("closes disputes after the window and blocks evaluator self-disputes", async () => {
    const { attestor, evaluator, bob, agent, terms } = await withPublished();
    await agent.registerFor(evaluator.address, "evaluator");
    await time.increaseTo(Number(terms.endTime) + 1);
    await attestor.connect(evaluator).attest(1, Outcome.Expired, 0, 0, EVIDENCE);
    await expect(attestor.connect(evaluator).dispute(1, ethers.ZeroHash)).to.be.revertedWithCustomError(attestor, "EvaluatorCannotDispute");
    await time.increase(2 * DAY + 1);
    await expect(attestor.connect(bob).dispute(1, ethers.ZeroHash)).to.be.revertedWithCustomError(attestor, "WindowClosed");
  });

  it("permissionlessly forfeits unrevealed theses past revealBy and hidden cancellations", async () => {
    const { attestor, registry, alice, outsider } = await loadFixture(deployAll);
    const now = await time.latest();
    await registry.connect(alice).commit(ethers.id("h1"), now + 2 * DAY);
    await expect(attestor.connect(outsider).forfeit(1)).to.be.revertedWithCustomError(attestor, "NotForfeitable");
    await time.increase(3 * DAY);
    await expect(attestor.connect(outsider).forfeit(1)).to.emit(attestor, "OutcomeFinalized").withArgs(1n, Outcome.Forfeited);
    await expect(attestor.forfeit(1)).to.be.revertedWithCustomError(attestor, "BadState");

    await registry.connect(alice).commit(ethers.id("h2"), (await time.latest()) + 10 * DAY);
    await registry.connect(alice).cancel(2);
    await expect(attestor.forfeit(2)).to.emit(attestor, "OutcomeFinalized").withArgs(2n, Outcome.Forfeited);
  });

  it("does not forfeit revealed theses", async () => {
    const { attestor } = await withPublished();
    await time.increase(40 * DAY);
    await expect(attestor.forfeit(1)).to.be.revertedWithCustomError(attestor, "NotForfeitable");
  });

  it("refuses zero registry", async () => {
    const { agent, deployer } = await loadFixture(deployAll);
    const F = await ethers.getContractFactory("OutcomeAttestor");
    await expect(F.deploy(await agent.getAddress(), ethers.ZeroAddress, DAY, deployer.address)).to.be.revertedWithCustomError(F, "ZeroAddress");
  });
});
