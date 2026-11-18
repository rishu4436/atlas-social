/** Verify deployed contracts on BscScan (Etherscan V2 key in ETHERSCAN_API_KEY) and Sourcify. */
import { run, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function verify(address: string, constructorArguments: unknown[], contract?: string) {
  try {
    await run("verify:verify", { address, constructorArguments, contract });
    console.log(`verified ${address}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/already verified/i.test(msg)) console.log(`already verified ${address}`);
    else console.error(`verify failed ${address}: ${msg}`);
  }
}

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  if (d.agentIdIsMock) await verify(d.agentId, [], "contracts/mocks/MockAgentID.sol:MockAgentID");
  await verify(d.AtlasIdentity, [d.agentId]);
  await verify(d.ThesisRegistry, [d.agentId]);
  await verify(d.OutcomeAttestor, [d.agentId, d.ThesisRegistry, d.disputeWindow, d.attestorOwner]);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
