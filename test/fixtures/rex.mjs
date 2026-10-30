#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, watchFile } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const statePath = join(directory, "state.json");
const read = () => JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
if (args.shift() !== "--autostart=false") process.exit(2);
if (args[0] === "--timeout") args.splice(0, 2);
const command = args;
if (command.at(-1) !== "--json") process.exit(2);

if (command[0] === "events") {
  writeFileSync(join(directory, "pid"), String(process.pid));
  console.log(JSON.stringify({ type: "session_event", payload: {
    session_id: "session:test", event: { type: "client_connected", payload: {} },
  } }));
  let emitted = 0;
  watchFile(statePath, { interval: 10 }, () => {
    const state = read();
    for (const event of (state.events ?? []).slice(emitted)) console.log(JSON.stringify(event));
    emitted = (state.events ?? []).length;
    if (state.exit) process.exit(0);
  });
} else {
  const state = read();
  if (state.queryError) process.exit(4);
  if (state.malformed) {
    console.log("not json");
  } else if (command[0] === "block") {
    if (command[1] !== "inspect" || command[2] !== "block:test" || command[4] !== "session:test") process.exit(2);
    console.log(JSON.stringify({ block: { owner: state.owner } }));
  } else if (command[0] === "client" && command[1] === "inspect") {
    if (state.holdOwner === command[2]) {
      writeFileSync(join(directory, "held-query"), String(process.pid));
      while (!existsSync(join(directory, "release-query"))) await setTimeout(10);
    }
    console.log(JSON.stringify({ client: { info: state.clients[command[2]] } }));
  } else process.exit(2);
}
