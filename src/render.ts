import { ToolExecutionComponent, type Theme, type ToolRenderers, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Box, Container, getCapabilities, stripTerminalSequences, truncateToWidth, visibleWidth, type Component, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";

type RenderContext = Parameters<NonNullable<ToolRenderers["renderCall"]>>[2];

const empty: Component = { render: () => [], invalidate() {} };
type ToolResult = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];

class NativeFallback implements Component {
  private tool: ToolExecutionComponent;

  constructor(name: string, original: ToolRenderers | undefined, context: RenderContext, resultOnly: boolean) {
    // Pi supplies only the missing slots; real custom renderers still receive the original context.
    const definition = original || resultOnly ? {
      renderShell: "self" as const,
      renderCall: original?.renderCall || resultOnly ? () => empty : undefined,
      renderResult: original?.renderResult ? () => empty : undefined,
    } : undefined;
    this.tool = new ToolExecutionComponent(name, context.toolCallId, context.args, {
      showImages: context.showImages,
      outputPad: context.outputPad,
    }, definition, { requestRender: context.invalidate } as TUI, context.cwd);
  }

  updateCall(args: unknown, context: RenderContext) {
    this.tool.updateArgs(args);
    this.tool.setOutputPad(context.outputPad);
    this.tool.setShowImages(context.showImages);
    this.tool.setExpanded(context.expanded);
  }

  updateResult(result: ToolResult, options: ToolRenderResultOptions, context: RenderContext) {
    // The outer Pi component owns inline images; keep native placeholders when images are hidden.
    const content = context.showImages && getCapabilities().images
      ? result.content.filter((block) => block.type !== "image")
      : result.content;
    this.tool.setExpanded(options.expanded);
    this.tool.updateResult({ ...result, content, isError: context.isError, durationMs: context.durationMs }, options.isPartial);
  }

  render(width: number) {
    // Pi's outer tool component already supplies the leading separator.
    return this.tool.render(width).slice(1);
  }

  invalidate() {
    this.tool.invalidate();
  }
}

function singleLine(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f\s]+/g, " ").trim();
}

function toolAppearance(context: RenderContext) {
  if (context.isPartial) {
    return { icon: "◌", foreground: "muted", background: "toolPendingBg" } as const;
  }
  if (context.isError) {
    return { icon: "✗", foreground: "error", background: "toolErrorBg" } as const;
  }
  return { icon: "✓", foreground: "success", background: "toolSuccessBg" } as const;
}

class ToolFrame implements Component {
  private content: Component;
  private theme: Theme;
  private replacePadding: boolean;

  constructor(content: Component, theme: Theme, replacePadding: boolean) {
    this.content = content;
    this.theme = theme;
    this.replacePadding = replacePadding;
  }

  render(width: number): string[] {
    const frameWidth = width - 1;
    if (frameWidth <= 0) return [];
    if (frameWidth < 5) return this.content.render(frameWidth).map((line) => truncateToWidth(line, frameWidth, "") + " ");
    const innerWidth = frameWidth - 2;
    const lines = this.content.render(innerWidth);
    if (!lines.length) return [];
    const body = this.replacePadding ? lines.slice(1, -1) : lines;
    const side = this.theme.fg("dim", "│");
    return [
      this.theme.fg("dim", `╭${"─".repeat(innerWidth)}╮`) + " ",
      ...body.map((line) => {
        const fitted = truncateToWidth(line, innerWidth, "");
        return `${side}${fitted}${" ".repeat(Math.max(0, innerWidth - visibleWidth(fitted)))}${side} `;
      }),
      this.theme.fg("dim", `╰${"─".repeat(innerWidth)}╯`) + " ",
    ];
  }

  handleMouse(event: TuiMouseEvent) {
    const frameWidth = event.width - 1;
    if (frameWidth <= 0 || event.x >= frameWidth) return undefined;
    if (frameWidth < 5) return this.content.handleMouse?.({ ...event, width: frameWidth });
    if (event.x <= 0 || event.x >= frameWidth - 1 || event.y <= 0 || event.y >= event.height - 1) return undefined;
    return this.content.handleMouse?.({
      ...event,
      x: event.x - 1,
      y: event.y - (this.replacePadding ? 0 : 1),
      width: frameWidth - 2,
      height: event.height - (this.replacePadding ? 0 : 2),
    });
  }

  invalidate() {
    this.content.invalidate();
  }
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
    fallback?: NativeFallback;
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
    const appearance = toolAppearance(context);
    const label = [params.path, params.file_path, params.command].find((value) => typeof value === "string");
    const error = context.isError ? state(context).error : undefined;
    return `${theme.fg("dim", "›")} ${theme.fg(appearance.foreground, appearance.icon)} ${theme.bold(singleLine(name))}` +
      (typeof label === "string" ? ` ${singleLine(label)}` : "") +
      (error ? ` — ${singleLine(error)}` : "");
  }

  return {
    renderShell: "self",
    renderCall(args, theme, context) {
      track(context);
      const cached = state(context);
      const folded = isMobile() && !context.expanded;
      if (!original?.renderCall || !original.renderResult) {
        cached.fallback ??= new NativeFallback(name, original, context, false);
        cached.fallback.updateCall(args, context);
      }
      cached.call = original?.renderCall
        ? original.renderCall(args, theme, { ...context, lastComponent: cached.call })
        : cached.fallback;
      const background = toolAppearance(context).background;
      const backgroundStyle = folded ? undefined : (text: string) => theme.bg(background, text);
      const selfRendered = original?.renderShell === "self" && !folded;
      cached.frame = selfRendered || (!original && !folded)
        ? new Container()
        : new Box(context.outputPad, 1, backgroundStyle);
      if (folded) {
        // Pi supplies the result after renderCall; read its cached error when drawing.
        cached.frame.addChild({
          render: (width) => [truncateToWidth(summary(args, theme, context), width)],
          invalidate() {},
        });
      } else if (cached.call) {
        cached.frame.addChild(cached.call);
      }
      return isMobile() ? new ToolFrame(cached.frame, theme, !selfRendered) : cached.frame;
    },
    renderResult(result, options, theme, context) {
      track(context);
      const cached = state(context);
      const errorBlock = context.isError
        ? result.content.find((block) => block.type === "text" && block.text.trim())
        : undefined;
      cached.error = errorBlock?.type === "text"
        ? errorBlock.text.split(/\r?\n/).find((line) => line.trim())
        : undefined;
      if (cached.fallback || !original?.renderResult) {
        cached.fallback ??= new NativeFallback(name, original, context, true);
        cached.fallback.updateResult(result, options, context);
      }
      if (original?.renderResult) {
        cached.result = original.renderResult(result, options, theme, { ...context, lastComponent: cached.result });
      } else {
        cached.result = original?.renderCall || !cached.frame ? cached.fallback : empty;
      }
      if (isMobile() && !options.expanded) return empty;
      if (!cached.result) return empty;
      if (cached.frame) {
        cached.frame.addChild(cached.result);
        return empty;
      }
      return cached.result;
    },
  };
}
