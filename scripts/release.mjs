// Publishes a new Todoom version: bumps the version everywhere, commits, tags
// and pushes. The tag triggers .github/workflows/release.yml, which builds and
// publishes the update that the app offers to install.
//
//   npm run release            -> 0.2.0 becomes 0.2.1
//   npm run release minor      -> 0.2.0 becomes 0.3.0
//   npm run release major      -> 0.2.0 becomes 1.0.0
//   npm run release 1.4.2      -> exact version

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// git with its arguments as a list: nothing goes through a shell.
const git = (...args) => execFileSync("git", args, { stdio: "inherit" });
const gitRead = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (gitRead("status", "--porcelain")) {
  console.error("Des modifications ne sont pas commitées : commite-les avant de publier une version.");
  process.exit(1);
}

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const [major, minor, patch] = conf.version.split(".").map(Number);
const arg = process.argv[2] ?? "patch";
const next = {
  patch: `${major}.${minor}.${patch + 1}`,
  minor: `${major}.${minor + 1}.0`,
  major: `${major + 1}.0.0`,
}[arg] ?? arg;

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error(`Version invalide : ${arg}`);
  process.exit(1);
}

const edit = (file, from, to) => {
  const text = readFileSync(file, "utf8");
  if (!from.test(text)) throw new Error(`Version introuvable dans ${file}`);
  writeFileSync(file, text.replace(from, to));
};
const quoted = (v) => `"version": "${v}"`;
edit("src-tauri/tauri.conf.json", /"version": "[^"]+"/, quoted(next));
edit("package.json", /"version": "[^"]+"/, quoted(next));
edit("package-lock.json", /("name": "todoom",\s*"version": )"[^"]+"/g, `$1"${next}"`);
edit("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${next}"`);
edit("src-tauri/Cargo.lock", /(name = "todoom"\r?\nversion = )"[^"]+"/, `$1"${next}"`);

console.log(`${conf.version} -> ${next}`);
git("add", "src-tauri/tauri.conf.json", "package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock");
git("commit", "-q", "-m", `Release v${next}`);
git("tag", `v${next}`);
git("push", "origin", "HEAD", `v${next}`);
console.log(`\nv${next} est partie : GitHub compile Windows + Mac (~10 min), puis Todoom proposera la mise à jour.`);
console.log("Suivi : https://github.com/mehdiAberkane/Todoom/actions");
