import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RexContext {
  command: string;
  session: string;
  block: string;
  server?: string;
}

export function getRexContext(env: NodeJS.ProcessEnv = process.env): RexContext | undefined {
  if (!env.REX_SESSION || !env.REX_BLOCK) return undefined;
  return {
    command: env.REX_BIN_DIR ? join(env.REX_BIN_DIR, "rex") : "rex",
    session: env.REX_SESSION,
    block: env.REX_BLOCK,
    ...(env.REX_SERVER ? { server: env.REX_SERVER } : {}),
  };
}

const cliOptions = ["--autostart=false", "--timeout", "2s"];

export async function hasIosOwner(context: RexContext, signal?: AbortSignal): Promise<boolean> {
  async function query(args: string[]) {
    const { stdout } = await execFileAsync(context.command, [...cliOptions, ...args, "--json"], {
      timeout: 2500,
      maxBuffer: 1024 * 1024,
      signal,
    });
    return JSON.parse(stdout);
  }

  const inspection = await query(["block", "inspect", context.block, "-s", context.session]);
  const owner: unknown = inspection?.block?.owner;
  if (typeof owner !== "string" || !owner) return false;
  const inspectionClient = await query(["client", "inspect", owner]);
  return inspectionClient?.client?.info?.kind === "app" &&
    inspectionClient?.client?.info?.platform === "ios";
}

export function watchRexOwner(context: RexContext, onMobile: (mobile: boolean) => void, onVerifiedOwner?: (mobile: boolean) => void): () => void {
  const controller = new AbortController();
  const child = spawn(context.command, [...cliOptions, "events", "-s", context.session, "--json"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = createInterface({ input: child.stdout });
  let stopped = false;
  let mobile = false;
  let revision = 0;
  let firstEvent = true;

  function publish(next: boolean) {
    if (mobile === next) return;
    mobile = next;
    onMobile(next);
  }

  async function refresh() {
    const current = ++revision;
    let next: boolean | undefined;
    try {
      next = await hasIosOwner(context, controller.signal);
    } catch {
      // Unavailable ownership information leaves Pi's normal rendering in place.
    }
    if (!stopped && current === revision) {
      if (next !== undefined) onVerifiedOwner?.(next);
      publish(next ?? false);
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    controller.abort();
    lines.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill();
    publish(false);
  }

  lines.on("line", (line) => {
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch {
      return;
    }
    const event = envelope?.payload?.event;
    const ownerChanged = envelope?.type === "session_event" &&
      envelope?.payload?.session_id === context.session &&
      event?.type === "block_owner_changed" && event?.payload?.block_id === context.block;
    if (firstEvent || ownerChanged) {
      firstEvent = false;
      void refresh();
    }
  });
  child.once("error", stop);
  child.once("exit", stop);
  child.once("spawn", () => { void refresh(); });
  return stop;
}
