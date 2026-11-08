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
  let thinking: ReturnType<typeof mobileThinking> | undefined;
  const redraws = new Map<object, () => void>();

  pi.registerToolRenderer((name, next) => compactToolRenderer(
    name,
    next(),
    () => mobile,
    (context) => redraws.set(context.state, context.invalidate),
    () => tuiContext?.ui.getToolsExpanded() ?? false,
  ));

  pi.on("session_start", async (_event, ctx) => {
    await thinking?.dispose(true);
    stop?.();
    redraws.clear();
    tuiContext = ctx.mode === "tui" ? ctx : undefined;
    thinking = undefined;
    if (!tuiContext) return;
    thinking = mobileThinking(pi, ctx, rex);
    let previousExpansion: boolean | undefined;
    stop = watchRexOwner(rex, (next) => {
      mobile = next;
      thinking?.setMobile(next);
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

  pi.on("session_shutdown", async (event) => {
    const cleanup = thinking?.dispose(["reload", "new", "resume", "fork"].includes(event.reason));
    stop?.();
    stop = undefined;
    mobile = false;
    tuiContext = undefined;
    redraws.clear();
    await cleanup;
    thinking = undefined;
  });
}

function mobileThinking(pi: ExtensionAPI, ctx: ExtensionContext, rex: RexContext) {
  let mobile = false;
  let collapsedByExtension = false;
  let stopping = false;
  let restoreOnStop = false;
  let disposed = false;
  let revision = 0;
  let attemptedRevision = -1;
  let editorFocused = () => false;
  let inFlight: Promise<void> | undefined;
  let pending: { target: boolean; received: boolean; forwarded: boolean; acknowledge: () => void } | undefined;
  const hidden = () => pi.getSettings().hideThinkingBlock ?? false;
  function target() {
    if (stopping && !restoreOnStop) return undefined;
    if (mobile) return true;
    return collapsedByExtension ? false : undefined;
  }
  function hasThinkingShortcut() {
    const keybindings = getKeybindings();
    return keybindings.matches("\x14", "app.thinking.toggle") &&
      !Object.entries(keybindings.getUserBindings()).some(([action, keys]) => action !== "app.thinking.toggle" &&
        (Array.isArray(keys) ? keys : keys ? [keys] : []).some((key) => matchesKey("\x14", key)));
  }

  const unsubscribe = ctx.ui.onTerminalInput((data) => {
    if (!pending || !matchesKey(data, "ctrl+t")) return;
    if (isKeyRelease(data)) return { consume: true };
    if (pending.received) return { consume: true };
    pending.received = true;
    queueMicrotask(pending.acknowledge);
    if (!editorFocused()) attemptedRevision = -1;
    pending.forwarded = editorFocused() && target() === pending.target && hidden() !== pending.target &&
      hasThinkingShortcut();
    if (!pending.forwarded) return { consume: true };
  });

  function observeFocus() {
    if (disposed) return;
    ctx.ui.setWidget("pi-rex-thinking", (tui) => {
      editorFocused = () => {
        if (!(tui instanceof TuiMainScreen || tui instanceof TuiAltScreen)) return false;
        if (tui.terminal instanceof ProcessTerminal && !process.stdin.isRaw) return false;
        const editor = tui.getFocusedComponent();
        return editor instanceof CustomEditor && editor.constructor === CustomEditor;
      };
      return {
        render() {
          void synchronize();
          return [];
        },
        invalidate() {},
      };
    });
  }

  function synchronize(): Promise<void> | undefined {
    if (inFlight) return inFlight;
    if (disposed || attemptedRevision === revision) return;
    const next = target();
    if (next === undefined || hidden() === next) {
      if (!mobile) collapsedByExtension = false;
      attemptedRevision = revision;
      return;
    }
    if (!editorFocused()) return;
    const current = revision;
    attemptedRevision = current;
    if (!hasThinkingShortcut()) {
      ctx.ui.notify("pi-rex: automatic thinking collapse requires Pi's unambiguous Ctrl+T binding.", "warning");
      return;
    }
    const attempt = { target: next, received: false, forwarded: false, acknowledge: () => {} };
    const handled = new Promise<void>((resolve) => { attempt.acknowledge = resolve; });
    pending = attempt;
    inFlight = (async () => {
      const timeout = setTimeout(attempt.acknowledge, 2500);
      let sendFailed = false;
      try {
        try {
          await sendRexKey(rex, "ctrl+t");
        } catch {
          sendFailed = true;
        }
        await handled;
        if (attempt.forwarded && hidden() === next) collapsedByExtension = next;
        else if ((!attempt.received || attempt.forwarded) && !stopping) {
          ctx.ui.notify(`pi-rex: could not confirm thinking visibility${sendFailed ? " (Rex key delivery failed)" : ""}.`, "warning");
        }
      } finally {
        clearTimeout(timeout);
        pending = undefined;
        inFlight = undefined;
        if (revision !== current) void synchronize();
      }
    })();
    return inFlight;
  }

  return {
    setMobile(next: boolean) {
      if (stopping) return;
      mobile = next;
      revision++;
      observeFocus();
      void synchronize();
    },
    async dispose(restore: boolean) {
      stopping = true;
      restoreOnStop = restore;
      mobile = false;
      revision++;
      await inFlight;
      await synchronize();
      if (restore && collapsedByExtension && hidden()) {
        ctx.ui.notify("pi-rex: thinking remains hidden; restore it with Ctrl+T in Pi's editor.", "warning");
      }
      disposed = true;
      unsubscribe();
      ctx.ui.setWidget("pi-rex-thinking", undefined);
    },
  };
}
