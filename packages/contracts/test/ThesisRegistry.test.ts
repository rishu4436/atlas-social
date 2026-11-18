import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, longTerms, px, DAY, b32 } from "./fixtures";

const SALT = ethers.id("salt-1");

describe("ThesisRegistry", () => {
  describe("commit / reveal", () => {
    it("commits a hidden thesis then reveals matching terms", async () => {
      const { registry, alice } = await loadFixture(deployAll);
      const terms = await longTerms();
      const c = await registry.computeCommitment(alice.address, terms, SALT);
      const revealBy = (await time.latest()) + 30 * DAY;
      await expect(registry.connect(alice).commit(c, revealBy))
        .to.emit(registry, "ThesisCommitted")
        .withArgs(1n, alice.address, c, revealBy, "alice");
      const t = await registry.getThesis(1);
      expect(t.status).to.equal(1n);
      await expect(registry.getTerms(1)).to.be.revertedWithCustomError(registry, "BadStatus");
      await expect(registry.connect(alice).reveal(1, terms, SALT)).to.emit(registry, "ThesisRevealed");
      const stored = await registry.getTerms(1);
      expect(stored.targetPrice).to.equal(px(660));
      expect(await registry.isRevealed(1)).to.equal(true);
      expect(await registry.authoredCount(alice.address)).to.equal(1n);
    });

    it("anyone holding the salt may reveal, but terms must match exactly", async () => {
      const { registry, alice, outsider } = await loadFixture(deployAll);
      const terms = await longTerms();
      const c = await registry.computeCommitment(alice.address, terms, SALT);
      await registry.connect(alice).commit(c, (await time.latest()) + 30 * DAY);
      const tampered = { ...terms, targetPrice: px(700) };
      await expect(registry.connect(outsider).reveal(1, tampered, SALT)).to.be.revertedWithCustomError(
        registry,
        "CommitmentMismatch",
      );
      await expect(registry.connect(outsider).reveal(1, terms, ethers.id("wrong"))).to.be.revertedWithCustomError(
        registry,
        "CommitmentMismatch",
      );
      await expect(registry.connect(outsider).reveal(1, terms, SALT)).to.emit(registry, "ThesisRevealed");
    });

    it("binds the commitment to the author: a copied commitment cannot be revealed for another author", async () => {
      const { registry, alice, bob } = await loadFixture(deployAll);
      const terms = await longTerms();
      const aliceC = await registry.computeCommitment(alice.address, terms, SALT);
      // bob front-runs alice by copying her commitment hash
      await registry.connect(bob).commit(aliceC, (await time.latest()) + 30 * DAY);
      // revealing with alice's terms fails because the hash includes the author (bob != alice)
      await expect(registry.connect(bob).reveal(1, terms, SALT)).to.be.revertedWithCustomError(
        registry,
        "CommitmentMismatch",
      );
      // and alice can't reuse the same hash (already taken) - she simply re-salts
      await expect(registry.connect(alice).commit(aliceC, (await time.latest()) + 30 * DAY))
        .to.be.revertedWithCustomError(registry, "CommitmentExists")
        .withArgs(1n);
    });

    it("publish commits and reveals in one transaction", async () => {
      const { registry, alice } = await loadFixture(deployAll);
      const terms = await longTerms();
      await expect(registry.connect(alice).publish(terms, SALT, (await time.latest()) + 30 * DAY))
        .to.emit(registry, "ThesisCommitted")
        .and.to.emit(registry, "ThesisRevealed");
      expect((await registry.getThesis(1)).status).to.equal(2n);
    });

    it("rejects reveal after the reveal deadline", async () => {
      const { registry, alice } = await loadFixture(deployAll);
      const now = await time.latest();
      const terms = await longTerms({ endTime: now + 2 * DAY });
      const c = await registry.computeCommitment(alice.address, terms, SALT);
      await registry.connect(alice).commit(c, now + 3 * DAY);
      await time.increase(4 * DAY);
      await expect(registry.connect(alice).reveal(1, terms, SALT)).to.be.revertedWithCustomError(
        registry,
        "RevealWindowClosed",
      );
    });

    it("only Agent ID holders can commit or publish", async () => {
      const { registry, outsider } = await loadFixture(deployAll);
      const terms = await longTerms();
      await expect(registry.connect(outsider).commit(ethers.id("x"), (await time.latest()) + DAY))
        .to.be.revertedWithCustomError(registry, "NotAgentIdHolder");
      await expect(registry.connect(outsider).publish(terms, SALT, (await time.latest()) + 30 * DAY))
        .to.be.revertedWithCustomError(registry, "NotAgentIdHolder");
    });

    it("validates revealBy bounds and zero commitment", async () => {
      const { registry, alice } = await loadFixture(deployAll);
      const now = await time.latest();
      await expect(registry.connect(alice).commit(ethers.ZeroHash, now + DAY)).to.be.revertedWithCustomError(
        registry,
        "InvalidCommitment",
      );
      await expect(registry.connect(alice).commit(ethers.id("a"), now)).to.be.revertedWithCustomError(
        registry,
        "InvalidRevealBy",
      );
      await expect(registry.connect(alice).commit(ethers.id("a"), now + 401 * DAY)).to.be.revertedWithCustomError(
        registry,
        "InvalidRevealBy",
      );
    });
  });

  describe("term validation", () => {
    const cases: [string, (now: number) => Record<string, unknown>][] = [
      ["market", () => ({ market: ethers.ZeroHash })],
      ["priceSource", () => ({ priceSource: ethers.ZeroHash })],
      ["start before commit", (now) => ({ startTime: now - 10 })],
      ["window", (now) => ({ startTime: now + 100, endTime: now + 100 })],
      ["end after revealBy", (now) => ({ endTime: now + 60 * DAY })],
      ["confidence", () => ({ confidenceBps: 10001 })],
      ["levels", () => ({ targetPrice: 0n })],
      ["long levels", () => ({ targetPrice: px(500), invalidationPrice: px(570), entryPrice: 0n })],
      ["long entry", () => ({ entryPrice: px(700) })],
      ["direction", () => ({ direction: 3 })],
      ["short levels", () => ({ direction: 2 })],
      ["short entry", () => ({ direction: 2, targetPrice: px(550), invalidationPrice: px(620), entryPrice: px(630) })],
    ];
    for (const [reason, mk] of cases) {
      it(`rejects invalid terms: ${reason}`, async () => {
        const { registry, alice } = await loadFixture(deployAll);
        const now = await time.latest();
        const terms = await longTerms(mk(now));
        await expect(registry.connect(alice).publish(terms, SALT, now + 30 * DAY))
          .to.be.revertedWithCustomError(registry, "InvalidTerms")
          .withArgs(reason);
      });
    }

    it("accepts a valid short with market entry", async () => {
      const { registry, alice } = await loadFixture(deployAll);
      const now = await time.latest();
      const terms = await longTerms({ direction: 2, entryPrice: 0n, targetPrice: px(520), invalidationPrice: px(640) });
      await expect(registry.connect(alice).publish(terms, SALT, now + 30 * DAY)).to.emit(registry, "ThesisRevealed");
    });
  });

  describe("corrections, cancellation, reviews", () => {
    async function published() {
      const f = await loadFixture(deployAll);
      const terms = await longTerms();
      await f.registry.connect(f.alice).publish(terms, SALT, (await time.latest()) + 30 * DAY);
      return { ...f, terms };
    }

    it("appends corrections without touching terms; only the author", async () => {
      const { registry, alice, bob, terms } = await published();
      await expect(registry.connect(alice).correct(1, ethers.id("typo fix"))).to.emit(registry, "ThesisCorrected").withArgs(1n, 1n, ethers.id("typo fix"));
      await registry.connect(alice).correct(1, ethers.id("second"));
      expect((await registry.getThesis(1)).corrections).to.equal(2n);
      expect((await registry.getTerms(1)).targetPrice).to.equal(terms.targetPrice);
      await expect(registry.connect(bob).correct(1, ethers.id("x"))).to.be.revertedWithCustomError(registry, "NotAuthor");
    });

    it("records cancellation permanently and blocks further corrections", async () => {
      const { registry, alice, bob } = await published();
      await expect(registry.connect(bob).cancel(1)).to.be.revertedWithCustomError(registry, "NotAuthor");
      await expect(registry.connect(alice).cancel(1)).to.emit(registry, "ThesisCancelled").withArgs(1n, false);
      const t = await registry.getThesis(1);
      expect(t.status).to.equal(3n);
      expect(t.cancelledAt).to.be.gt(0n);
      await expect(registry.connect(alice).cancel(1)).to.be.revertedWithCustomError(registry, "BadStatus");
      await expect(registry.connect(alice).correct(1, ethers.id("x"))).to.be.revertedWithCustomError(registry, "BadStatus");
      // terms stay readable after cancellation (history is never erased)
      expect((await registry.getTerms(1)).market).to.equal(b32("BINANCE:BNBUSDT"));
    });

    it("flags cancel-before-reveal", async () => {
      const { registry, alice } = await loadFixture(deployAll);
      await registry.connect(alice).commit(ethers.id("hidden"), (await time.latest()) + 10 * DAY);
      await expect(registry.connect(alice).cancel(1)).to.emit(registry, "ThesisCancelled").withArgs(1n, true);
      expect((await registry.getThesis(1)).cancelledBeforeReveal).to.equal(true);
    });

    it("lets other holders endorse or challenge once; never the author or non-holders", async () => {
      const { registry, alice, bob, carol, outsider } = await published();
      await expect(registry.connect(bob).review(1, 1, ethers.id("solid"))).to.emit(registry, "ThesisReviewed").withArgs(1n, bob.address, 1, ethers.id("solid"), "bob");
      await registry.connect(carol).review(1, 2, ethers.id("volume is weak"));
      const t = await registry.getThesis(1);
      expect(t.endorsements).to.equal(1n);
      expect(t.challenges).to.equal(1n);
      await expect(registry.connect(bob).review(1, 2, ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "AlreadyReviewed");
      await expect(registry.connect(alice).review(1, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "SelfReview");
      await expect(registry.connect(outsider).review(1, 1, ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "NotAgentIdHolder");
      await expect(registry.connect(carol).review(1, 9, ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "InvalidStance");
    });

    it("reverts on unknown thesis ids", async () => {
      const { registry, alice } = await loadFixture(deployAll);
      await expect(registry.getThesis(42)).to.be.revertedWithCustomError(registry, "UnknownThesis").withArgs(42n);
      await expect(registry.connect(alice).correct(42, ethers.ZeroHash)).to.be.revertedWithCustomError(registry, "UnknownThesis");
    });
  });
});
