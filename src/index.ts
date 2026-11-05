import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { compactToolRenderer } from "./render.ts";
import { getRexContext, watchRexOwner } from "./rex.ts";

export default function rexExtension(pi: ExtensionAPI) {
  const rex = getRexContext();
  if (!rex) return;

  let mobile = false;
  let tuiContext: ExtensionContext | undefined;
  let stop: (() => void) | undefined;
  const redraws = new Map<object, () => void>();

  pi.registerToolRenderer((name, next) => compactToolRenderer(
    name,
    next(),
    () => mobile,
    (context) => redraws.set(context.state, context.invalidate),
    () => tuiContext?.ui.getToolsExpanded() ?? false,
  ));

  pi.on("session_start", (_event, ctx) => {
    stop?.();
    redraws.clear();
    tuiContext = ctx.mode === "tui" ? ctx : undefined;
    if (!tuiContext) return;
    let previousExpansion: boolean | undefined;
    stop = watchRexOwner(rex, (next) => {
      mobile = next;
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

  pi.on("session_shutdown", () => {
    stop?.();
    stop = undefined;
    mobile = false;
    tuiContext = undefined;
    redraws.clear();
  });
}
