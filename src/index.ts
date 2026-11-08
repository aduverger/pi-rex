import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, isKeyRelease, matchesKey, ProcessTerminal, TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";
import { compactToolRenderer } from "./render.ts";
import { getRexContext, sendRexKey, watchRexOwner, type RexContext } from "./rex.ts";

export default function rexExtension(pi: ExtensionAPI) {
  const rex = getRexContext();
  if (!rex) return;

  let mobile = false;
  let tuiContext: ExtensionContext | undefined;
  let stop: (() => void) | undefined;
  let stopThinking: (() => Promise<void>) | undefined;
  const redraws = new Map<object, () => void>();

  pi.registerToolRenderer((name, next) => compactToolRenderer(
    name,
    next(),
    () => mobile,
    (context) => redraws.set(context.state, context.invalidate),
    () => tuiContext?.ui.getToolsExpanded() ?? false,
  ));

  pi.on("session_start", async (_event, ctx) => {
    await stopThinking?.();
    stop?.();
    redraws.clear();
    tuiContext = ctx.mode === "tui" ? ctx : undefined;
    stopThinking = undefined;
    if (!tuiContext) return;

    let restoreThinking = false;
    let thinkingPending = false;
    let thinkingTask: Promise<void> | undefined;
    const shortcut = thinkingShortcut(pi, ctx, rex, updateThinking);
    stopThinking = async () => { shortcut.stop(); await thinkingTask; };

    function updateThinking() {
      if (!thinkingPending || thinkingTask || !shortcut.ready()) return;
      thinkingPending = false;
      const onMobile = mobile;
      thinkingTask = (async () => {
        const hidden = pi.getSettings().hideThinkingBlock ?? false;
        let toggled: boolean | undefined = false;
        if (onMobile && !hidden) toggled = await shortcut.toggle(true, () => mobile);
        else if (!onMobile && restoreThinking) {
          if (!hidden) restoreThinking = false;
          else toggled = await shortcut.toggle(false, () => !mobile);
        }
        if (toggled) restoreThinking = onMobile;
        if (toggled === undefined) thinkingPending = true;
      })().finally(() => { thinkingTask = undefined; updateThinking(); });
    }

    let previousExpansion: boolean | undefined;
    stop = watchRexOwner(rex, (next) => {
      mobile = next;
      thinkingPending = true;
      updateThinking();
      if (next) {
        previousExpansion = ctx.ui.getToolsExpanded();
        ctx.ui.setToolsExpanded(false);
      } else if (previousExpansion !== undefined) {
        ctx.ui.setToolsExpanded(previousExpansion);
        previousExpansion = undefined;
      }
      for (const redraw of redraws.values()) redraw();
    });
  });

  pi.on("session_shutdown", async () => {
    const cleanup = stopThinking?.();
    stop?.();
    stop = undefined;
    mobile = false;
    tuiContext = undefined;
    redraws.clear();
    await cleanup;
    stopThinking = undefined;
  });
}

function thinkingShortcut(pi: ExtensionAPI, ctx: ExtensionContext, rex: RexContext, onReady: () => void) {
  let stopped = false;
  let inputReady = () => false;
  let cancel: (() => void) | undefined;
  const ready = () => !stopped && inputReady();

  ctx.ui.setWidget("pi-rex-thinking", (tui) => {
    inputReady = () => {
      if (!(tui instanceof TuiMainScreen || tui instanceof TuiAltScreen)) return false;
      if (tui.terminal instanceof ProcessTerminal && !process.stdin.isRaw) return false;
      const editor = tui.getFocusedComponent();
      return editor instanceof CustomEditor && editor.constructor === CustomEditor;
    };
    return { render() { onReady(); return []; }, invalidate() {} };
  });

  function hasBinding() {
    const keybindings = getKeybindings();
    if (!keybindings.matches("\x14", "app.thinking.toggle")) return false;
    for (const [action, binding] of Object.entries(keybindings.getUserBindings())) {
      if (action === "app.thinking.toggle" || !binding) continue;
      const keys = Array.isArray(binding) ? binding : [binding];
      if (keys.some((key) => matchesKey("\x14", key))) return false;
    }
    return true;
  }

  return {
    ready,
    // Undefined defers for focus; false means no confirmed change.
    async toggle(hidden: boolean, isCurrent: () => boolean): Promise<boolean | undefined> {
      if (!ready()) return undefined;
      if (!hasBinding()) {
        ctx.ui.notify("pi-rex: automatic thinking collapse requires Pi's unambiguous Ctrl+T binding.", "warning");
        return false;
      }
      let received = false;
      let forwarded = false;
      let finish: (result: boolean | undefined) => void = () => {};
      const handled = new Promise<boolean | undefined>((resolve) => { finish = resolve; });
      cancel = () => finish(false);
      const unsubscribe = ctx.ui.onTerminalInput((data) => {
        if (!matchesKey(data, "ctrl+t")) return;
        if (isKeyRelease(data) || received) return { consume: true };
        received = true;
        const blocked = !ready();
        forwarded = !blocked && isCurrent() && (pi.getSettings().hideThinkingBlock ?? false) !== hidden && hasBinding();
        queueMicrotask(() => finish(blocked && !stopped && isCurrent() ? undefined :
          forwarded && (pi.getSettings().hideThinkingBlock ?? false) === hidden));
        if (!forwarded) return { consume: true };
      });
      const timeout = setTimeout(() => finish(false), 2500);
      try {
        // A CLI error does not prove input was undelivered; keep the receipt guard until confirmation or timeout.
        await sendRexKey(rex, "ctrl+t").catch(() => {});
        const toggled = await handled;
        if (toggled === false && (!received || forwarded) && !stopped && isCurrent()) {
          ctx.ui.notify("pi-rex: could not confirm thinking visibility.", "warning");
        }
        return stopped ? false : toggled;
      } finally {
        clearTimeout(timeout);
        unsubscribe();
        cancel = undefined;
      }
    },
    stop() {
      stopped = true;
      cancel?.();
      ctx.ui.setWidget("pi-rex-thinking", undefined);
    },
  };
}
