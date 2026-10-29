import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text, stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];
type Result = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];

const empty: Component = { render: () => [], invalidate() {} };

function singleLine(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f\s]+/g, " ").trim();
}

class Summary implements Component {
  constructor(text: () => string) {
    this.text = text;
  }
  private text: () => string;
  render(width: number): string[] {
    return [truncateToWidth(this.text(), width)];
  }
  invalidate() {}
}

export function compactToolRenderer(
  name: string,
  original: ToolRenderers | undefined,
  isMobile: () => boolean,
  track: (context: RenderContext) => void,
): ToolRenderers {
  const states = new WeakMap<object, {
    call?: Component;
    result?: Component;
    error?: string;
    frame?: Box | Container;
  }>();
  function state(context: RenderContext) {
    let value = states.get(context.state);
    if (!value) {
      value = {};
      states.set(context.state, value);
    }
    return value;
  }

  function summary(args: unknown, theme: Theme, context: RenderContext) {
    const params = args && typeof args === "object" ? args as Record<string, unknown> : {};
    const status = context.isPartial ? "◌" : context.isError ? "✗" : "✓";
    const color = context.isPartial ? "muted" : context.isError ? "error" : "success";
    const label = [params.path, params.file_path, params.command].find((value) => typeof value === "string");
    const error = context.isError ? state(context).error : undefined;
    return `${theme.fg("dim", "›")} ${theme.fg(color, status)} ${theme.bold(singleLine(name))}` +
      (typeof label === "string" ? ` ${singleLine(label)}` : "") +
      (error ? ` — ${singleLine(error)}` : "");
  }

  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      track(context);
      const cached = state(context);
      const folded = isMobile() && !context.expanded;
      const background = context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
      cached.frame = original?.renderShell === "self"
        ? new Container()
        : new Box(context.outputPad, 1, folded ? undefined : (text) => theme.bg(background, text));
      if (folded) {
        cached.frame.addChild(new Summary(() => summary(args, theme, context)));
      } else {
        cached.call = original?.renderCall
          ? original.renderCall(args, theme, { ...context, lastComponent: cached.call })
          : new Text(`${name}\n${JSON.stringify(args, null, 2) ?? ""}`, 0, 0);
        cached.frame.addChild(cached.call);
      }
      return cached.frame;
    },
    renderResult(result: Result, options, theme, context) {
      track(context);
      const cached = state(context);
      const errorBlock = context.isError
        ? result.content.find((block) => block.type === "text" && block.text.trim())
        : undefined;
      cached.error = errorBlock?.type === "text"
        ? errorBlock.text.split(/\r?\n/).find((line) => line.trim())
        : undefined;
      if (isMobile() && !options.expanded) return empty;
      cached.result = original?.renderResult
        ? original.renderResult(result, options, theme, { ...context, lastComponent: cached.result })
        : new Text(result.content.map((block) => block.type === "text" ? block.text : "").join("\n"), 0, 0);
      if (cached.frame) {
        cached.frame.addChild(cached.result);
        return empty;
      }
      return cached.result;
    },
  };
}
