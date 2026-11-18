import { encodeFunctionData, type Address, type Hex } from "viem";
import {
  AtlasIdentityRegistryAbi, AtlasThesisRegistryAbi, AtlasReviewRegistryAbi, AtlasOutcomeRegistryAbi,
  termsToAbi, type ThesisTerms, type ReviewStance, type EvidenceKind,
} from "@atlas/shared-types";
import type { UnsignedTx } from "./pancakeswap.js";

const tx = (chainId: number, from: Address, to: Address, data: Hex, description: string): UnsignedTx => ({ chainId, from, to, data, value: "0", description });

export const atlasCalls = {
  registerIdentity: (chainId: number, from: Address, registry: Address, commitment: Hex) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasIdentityRegistryAbi, functionName: "registerIdentity", args: [commitment] }), "Prove Agent ID ownership for ATLAS sign-in (no value, no approvals)"),
  publishThesis: (chainId: number, from: Address, registry: Address, terms: ThesisTerms, salt: Hex) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasThesisRegistryAbi, functionName: "publishThesis", args: [termsToAbi(terms), salt] }), "Publish an immutable thesis on-chain (no value, no approvals)"),
  commitThesis: (chainId: number, from: Address, registry: Address, commitment: Hex, revealDeadline: bigint) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasThesisRegistryAbi, functionName: "commitThesis", args: [commitment, revealDeadline] }), "Commit a private thesis hash (terms stay hidden until you reveal)"),
  revealThesis: (chainId: number, from: Address, registry: Address, thesisId: bigint, terms: ThesisTerms, salt: Hex) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasThesisRegistryAbi, functionName: "revealThesis", args: [thesisId, termsToAbi(terms), salt] }), "Reveal the committed thesis terms"),
  appendCorrection: (chainId: number, from: Address, registry: Address, thesisId: bigint, noteHash: Hex) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasThesisRegistryAbi, functionName: "appendCorrection", args: [thesisId, noteHash] }), "Append a correction note (original terms stay unchanged)"),
  cancelThesis: (chainId: number, from: Address, registry: Address, thesisId: bigint) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasThesisRegistryAbi, functionName: "cancelThesis", args: [thesisId] }), "Cancel the thesis (permanent and public; counts in your record)"),
  publishReview: (chainId: number, from: Address, registry: Address, thesisId: bigint, stance: ReviewStance, contentHash: Hex) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasReviewRegistryAbi, functionName: "publishReview", args: [thesisId, stance, contentHash] }), "Publish an attributable review"),
  challengeEvidence: (chainId: number, from: Address, registry: Address, thesisId: bigint, kind: EvidenceKind, evidenceHash: Hex, reasonHash: Hex) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasReviewRegistryAbi, functionName: "challengeEvidence", args: [thesisId, kind, evidenceHash, reasonHash] }), "Challenge a piece of evidence on-chain"),
  challengeOutcome: (chainId: number, from: Address, registry: Address, thesisId: bigint, reasonHash: Hex) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasOutcomeRegistryAbi, functionName: "challengeOutcome", args: [thesisId, reasonHash] }), "Challenge the proposed outcome during the dispute window"),
  finalizeOutcome: (chainId: number, from: Address, registry: Address, thesisId: bigint) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasOutcomeRegistryAbi, functionName: "finalizeOutcome", args: [thesisId] }), "Finalize an undisputed outcome"),
  forfeit: (chainId: number, from: Address, registry: Address, thesisId: bigint) =>
    tx(chainId, from, registry, encodeFunctionData({ abi: AtlasOutcomeRegistryAbi, functionName: "forfeit", args: [thesisId] }), "Mark an unrevealed thesis as forfeited"),
};
