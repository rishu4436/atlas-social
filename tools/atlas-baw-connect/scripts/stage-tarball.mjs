#!/usr/bin/env node
/** Build and copy atlas-social-connect.tgz into the web app public folder for one-liner fallback. */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const destDir = join(pkgDir, "../../apps/web/public");
mkdirSync(destDir, { recursive: true });
execFileSync("npx", ["tsc", "-p", "tsconfig.build.json"], { cwd: pkgDir, stdio: "inherit" });
for (const f of readdirSync(pkgDir)) {
  if (f.startsWith("atlas-social-connect-") && f.endsWith(".tgz")) unlinkSync(join(pkgDir, f));
}
execFileSync("npm", ["pack"], { cwd: pkgDir, stdio: "inherit" });
const tgz = readdirSync(pkgDir).filter((f) => f.startsWith("atlas-social-connect-") && f.endsWith(".tgz"));
if (tgz.length !== 1) throw new Error(`expected one tarball, got ${tgz.join(", ") || "none"}`);
copyFileSync(join(pkgDir, tgz[0]), join(destDir, "atlas-social-connect.tgz"));
unlinkSync(join(pkgDir, tgz[0]));
console.log(`staged ${destDir}/atlas-social-connect.tgz`);
