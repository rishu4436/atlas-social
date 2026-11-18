import type { Deps } from "../deps.js";
import { ApiError } from "./errors.js";

/** On-chain actions are refused (503) until the ATLAS registries exist on the configured chain. Never fakes success. */
export function assertContractsDeployed(deps: Pick<Deps, "contracts">) {
  if (!deps.contracts.atlasDeployed)
    throw new ApiError(503, "CONTRACTS_PENDING", "ATLAS contracts are pending deployment on this chain. On-chain actions are disabled until they are deployed and verified.");
}
