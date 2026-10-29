#!/usr/bin/env node
import { readFileSync, writeFileSync, watchFile } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const statePath = join(directory, "state.json");
const read = () => JSON.parse(readFileSync(statePath, "utf8"));
const args = process.argv.slice(2);
if (args[0] !== "--autostart=false" || args[1] !== "--timeout" || args[2] !== "2s") process.exit(2);
const command = args.slice(3);
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
    console.log(JSON.stringify({ client: { info: state.clients[command[2]] } }));
  } else process.exit(2);
}
