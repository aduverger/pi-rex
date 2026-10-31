import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { TestContext } from "node:test";
import { RexControl } from "../../src/control.ts";

export async function startRex(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "pirex-lab-"));
  const endpoint = `unix://${join(directory, "rex.sock")}`;
  const config = join(directory, "init.lua");
  await writeFile(config, "");
  const command = process.env.REX_BIN_DIR ? join(process.env.REX_BIN_DIR, "rex") : "rex";
  let diagnostic = "";
  const server = spawn(command, ["server", "run", "--listen", endpoint, "--state-dir", join(directory, "state"), "--config", config, "--restore=false"], {
    env: { ...process.env, HOME: directory, XDG_CONFIG_HOME: directory, XDG_RUNTIME_DIR: directory, REX_SERVER: endpoint, REX_SESSION: "", REX_BLOCK: "", REX_CLIENT: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let failure: Error | undefined;
  server.on("error", (error) => { failure = error; });
  server.stderr.on("data", (chunk) => { diagnostic = (diagnostic + chunk).slice(-4000); });
  t.after(async () => {
    server.kill("SIGTERM");
    const exited = new Promise<void>((resolve) => { if (server.exitCode !== null || server.signalCode !== null || failure) resolve(); else server.once("exit", () => resolve()); });
    await Promise.race([exited, delay(3000, undefined, { ref: false })]);
    if (server.exitCode === null && server.signalCode === null && !failure) { server.kill("SIGKILL"); await exited; }
    await rm(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (failure) {
      if ((failure as NodeJS.ErrnoException).code === "ENOENT") { t.skip("Rex CLI is not installed"); return undefined; }
      throw failure;
    }
    if (server.exitCode !== null) throw new Error(`Isolated Rex exited: ${diagnostic}`);
    const control = new RexControl();
    try {
      await control.connect(endpoint, "pirex-test");
      t.after(() => control.close());
      return { control, endpoint, directory };
    } catch { control.close(); await delay(100); }
  }
  throw new Error(`Isolated Rex did not start: ${diagnostic}`);
}
