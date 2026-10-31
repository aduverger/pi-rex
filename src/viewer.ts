import { parseArgs } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { matchesKey, ProcessTerminal, TuiAltScreen } from "@earendil-works/pi-tui";
import { ViewerConnection } from "./viewer-connection.ts";
import { ViewerApp } from "./viewer-ui.ts";

async function main() {
  const { values } = parseArgs({ options: {
    server: { type: "string" }, session: { type: "string" }, "source-block": { type: "string" }, "source-pid": { type: "string" },
  } });
  const pid = Number(values["source-pid"]);
  if (!values.server || !values.session || !values["source-block"] || !Number.isSafeInteger(pid) || pid <= 0 || !process.env.REX_BLOCK || process.env.REX_SESSION !== values.session) {
    throw new Error("Start the viewer with /rex-view inside Pi, not as an independent agent");
  }
  initTheme("system", false);
  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal, true, undefined, { mouse: true, scrollToEndIndicator: () => "↓ Latest · Ctrl+End" });
  let app: ViewerApp;
  const connection = new ViewerConnection({ endpoint: values.server, session: values.session, block: values["source-block"], pid, viewerBlock: process.env.REX_BLOCK },
    (state) => app.update(state), () => app.status());
  app = new ViewerApp(tui, connection);
  tui.setLayoutRoot(app.root);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    connection.stop();
    clearInterval(liveness);
    tui.stop();
  };
  // Pi's extension shutdown also fires on /reload; only process death closes this view.
  const liveness = setInterval(() => {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") stop(); }
  }, 1000);
  tui.addInputListener((data) => {
    if (matchesKey(data, "ctrl+q") || (matchesKey(data, "ctrl+d") && !app.editor.getExpandedText())) {
      stop(); return { consume: true };
    }
    return undefined;
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  tui.start();
  try { await connection.run(); }
  finally { stop(); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}

main().catch((error) => { console.error(`Pi viewer: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; });
