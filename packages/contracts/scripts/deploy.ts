/**
 * Deploy ATLAS contracts.
 *   - bsc (56): uses the REAL Agent ID registry 0x60B9…022F (override with AGENT_ID_ADDRESS only if you know why).
 *   - bscTestnet (97) / hardhat: the real registry does not exist there, so a clearly-labelled MockAgentID is
 *     deployed unless AGENT_ID_ADDRESS is provided.
 * Requires DEPLOYER_PRIVATE_KEY in the environment for public networks. Never commit it.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const REAL_AGENT_ID = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const DISPUTE_WINDOW = Number(process.env.DISPUTE_WINDOW_SECONDS || 2 * 24 * 3600);

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in .env (testnet key only).");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`network=${network.name} chainId=${chainId} deployer=${deployer.address}`);
  console.log(`balance=${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} BNB`);

  if (chainId === 56 && process.env.CONFIRM_MAINNET !== "yes") {
    throw new Error("Refusing mainnet deploy without CONFIRM_MAINNET=yes (uses real BNB).");
  }

  let agentId = process.env.AGENT_ID_ADDRESS || (chainId === 56 ? REAL_AGENT_ID : "");
  let mock = false;
  if (!agentId) {
    const m = await ethers.deployContract("MockAgentID");
    await m.waitForDeployment();
    agentId = await m.getAddress();
    mock = true;
    console.log(`MockAgentID (TESTNET ONLY) ${agentId}`);
  }

  const identity = await ethers.deployContract("AtlasIdentity", [agentId]);
  await identity.waitForDeployment();
  const registry = await ethers.deployContract("ThesisRegistry", [agentId]);
  await registry.waitForDeployment();
  const owner = process.env.ATTESTOR_OWNER || deployer.address;
  const attestor = await ethers.deployContract("OutcomeAttestor", [agentId, await registry.getAddress(), DISPUTE_WINDOW, owner]);
  await attestor.waitForDeployment();

  const evaluators = (process.env.EVALUATOR_ADDRESSES || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (owner === deployer.address) {
    for (const e of evaluators) {
      await (await attestor.setEvaluator(e, true)).wait();
      console.log(`evaluator enabled ${e}`);
    }
  }

  const out = {
    network: network.name,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    agentId,
    agentIdIsMock: mock,
    AtlasIdentity: await identity.getAddress(),
    ThesisRegistry: await registry.getAddress(),
    OutcomeAttestor: await attestor.getAddress(),
    disputeWindow: DISPUTE_WINDOW,
    attestorOwner: owner,
    evaluators,
    blocks: { start: await ethers.provider.getBlockNumber() },
  };
  const suffix = network.name === "hardhat" || network.name === "localhost" ? ".local" : "";
  const file = path.join(__dirname, "..", "deployments", `${network.name}${suffix}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`saved ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
