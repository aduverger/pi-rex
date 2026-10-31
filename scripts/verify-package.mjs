import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const expected = {
  name: "@aduverger/pi-rex",
  repository: "git+https://github.com/aduverger/pi-rex.git",
  homepage: "https://github.com/aduverger/pi-rex#readme",
  bugs: "https://github.com/aduverger/pi-rex/issues",
  author: "Alexandre Duverger",
};
for (const [field, value] of Object.entries(expected)) {
  let actual = pkg[field];
  if (field === "repository") actual = pkg.repository?.url;
  if (field === "bugs") actual = pkg.bugs?.url;
  if (actual !== value) throw new Error(`package ${field} must be ${value}`);
}
if (pkg.publishConfig?.access !== "public") throw new Error("package must publish with public access");
if (!pkg.pi?.extensions?.includes("./src/index.ts")) throw new Error("Pi extension manifest missing");
for (const name of [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
]) {
  if (pkg.dependencies?.[name]) throw new Error(`${name} must remain a peer dependency`);
  if (pkg.peerDependencies?.[name] !== "*") throw new Error(`${name} must use Pi's bundled runtime`);
}

for (const name of ["ws", "jiti"]) {
  if (typeof pkg.dependencies?.[name] !== "string") throw new Error(`viewer runtime dependency missing: ${name}`);
}

const packEnvironment = {
  ...process.env,
  npm_config_cache: new URL("../.npm-cache", import.meta.url).pathname,
};
const packResult = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
    env: packEnvironment,
  }),
)[0];
const packed = new Set(packResult.files.map((file) => file.path));
const allowed = new Set([
  "LICENSE",
  "README.md",
  "package.json",
  "src/index.ts",
  "src/render.ts",
  "src/rex.ts",
  "src/control.ts",
  "src/conversation.ts",
  "src/dialogs.ts",
  "src/view-state.ts",
  "src/bridge.ts",
  "src/viewer-connection.ts",
  "src/viewer-ui.ts",
  "src/viewer.ts",
]);
for (const file of packed) {
  if (!allowed.has(file)) throw new Error(`package contains unapproved file: ${file}`);
}
for (const file of allowed) {
  if (!packed.has(file)) throw new Error(`package omits required file: ${file}`);
}
for (const file of packed) {
  if (/(^|\/)test\/|\.test\.|package-lock\.json|(^|\/)docs\//.test(file)) {
    throw new Error(`package contains forbidden development file: ${file}`);
  }
}
console.log("package verification passed");
