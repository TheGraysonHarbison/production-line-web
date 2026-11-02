// Builds the release tarball the standalone installer consumes (dev doc §15.3, roadmap Phase 11):
// the built server + client, the migrations, and just enough package metadata for
// `npm ci --omit=dev --workspace=packages/shared --workspace=server` to reproduce the runtime deps
// from the lockfile. Usage: node scripts/release.mjs [--no-build] [--version X.Y.Z] [--out DIR]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : (args[i + 1] ?? "");
};
const build = !args.includes("--no-build");
const version =
  flag("--version") ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const outDir = resolve(root, flag("--out") ?? "release");
const name = `production-line-web-${version}`;

if (build) execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });

// Everything the runtime and the installer need; nothing from the dev toolchain.
const FILES = [
  "package.json",
  "package-lock.json",
  "LICENSE",
  "README.md",
  "packages/shared/package.json",
  "packages/shared/dist",
  "server/package.json",
  "server/dist",
  "server/migrations",
  "server/public",
  // The lockfile knows the client workspace, so npm must see its manifest even though nothing
  // from it is installed.
  "client/package.json",
  "deploy/systemd/production-line.service",
  "scripts/install-standalone.sh",
  "scripts/uninstall-standalone.sh",
];

const stage = join(outDir, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const rel of FILES) {
  const from = join(root, rel);
  statSync(from); // throws when a build output is missing
  cpSync(from, join(stage, rel), { recursive: true });
}
writeFileSync(join(stage, "VERSION"), `${version}\n`);
// The tarball's manifest carries the release version even when the checkout still says 0.0.0.
const pkg = JSON.parse(readFileSync(join(stage, "package.json"), "utf8"));
pkg.version = version;
writeFileSync(join(stage, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const tarball = join(outDir, `${name}.tar.gz`);
execFileSync("tar", ["-czf", tarball, "-C", outDir, name], { stdio: "inherit" });
const digest = createHash("sha256").update(readFileSync(tarball)).digest("hex");
writeFileSync(`${tarball}.sha256`, `${digest}  ${name}.tar.gz\n`);
rmSync(stage, { recursive: true, force: true });
console.log(
  `${tarball} (${(statSync(tarball).size / 1024 / 1024).toFixed(1)} MB) sha256 ${digest}`,
);
