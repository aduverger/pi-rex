import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBashToolDefinition, createEditToolDefinition, createReadToolDefinition,
  createWriteToolDefinition, initTheme, ToolExecutionComponent, type Theme, type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { compactToolRenderer } from "../src/render.ts";
import { createToolHtmlRenderer } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/tool-renderer.js";

initTheme("dark", false);
const ui = { requestRender() {} } as TUI;
const plain = (component: ToolExecutionComponent, width = 40) => component.render(width).map(stripTerminalSequences);
const content = (component: ToolExecutionComponent, width = 40) => plain(component, width).filter((line) => line.trim());

function rendererTheme(): Theme {
  let theme: Theme | undefined;
  new ToolExecutionComponent("theme", "theme", {}, {}, {
    renderCall(_args, activeTheme) {
      theme = activeTheme;
      return new Text("", 0, 0);
    },
  }, ui, process.cwd());
  assert.ok(theme);
  return theme;
}

function tool(name: string, args: unknown, original?: ToolRenderers) {
  let mobile = true;
  let redraw = () => {};
  const renderer = compactToolRenderer(name, original, () => mobile, (context) => { redraw = context.invalidate; });
  const component = new ToolExecutionComponent(name, "call:1", args, { showImages: false }, renderer, ui, process.cwd());
  component.setArgsComplete();
  component.markExecutionStarted();
  return {
    component,
    setMobile(value: boolean) { mobile = value; redraw(); },
  };
}

function clickRow(component: ToolExecutionComponent, name: string) {
  const lines = plain(component);
  const y = lines.findIndex((line) => line.includes(name));
  assert.ok(y >= 0);
  const result = component.handleMouse({
    type: "click", button: "left", x: 2, y, screenX: 2, screenY: y,
    width: 40, height: lines.length, shift: false, alt: false, ctrl: false,
  });
  assert.equal(result?.handled, true);
}

const cases = [
  { name: "read", args: { path: "src/example.ts" }, definition: createReadToolDefinition(process.cwd()) as ToolRenderers, output: "const value = 42;" },
  { name: "write", args: { path: "src/example.ts", content: "const value = 42;\n" }, definition: createWriteToolDefinition(process.cwd()) as ToolRenderers, output: "Wrote file" },
  { name: "edit", args: { path: "src/example.ts", oldText: "41", newText: "42" }, definition: createEditToolDefinition(process.cwd()) as ToolRenderers, output: "Edited file" },
  { name: "bash", args: { command: "printf hello" }, definition: createBashToolDefinition(process.cwd()) as ToolRenderers, output: "hello" },
];

for (const { name, args, definition, output } of cases) {
  for (const isError of [false, true]) {
    test(`${name} ${isError ? "error" : "success"}: folded content is neutral, expanded and desktop views match native Pi`, () => {
      const { component, setMobile } = tool(name, args, definition);
      const result = { content: [{ type: "text", text: isError ? "Tool failed" : output }], details: undefined, isError };
      component.updateResult(result);
      const saved = structuredClone(result);
      assert.equal(content(component).length, 1);
      assert.match(content(component)[0], isError ? /✗/ : /✓/);
      assert.doesNotMatch(component.render(40).join("\n"), /\x1b\[(?:4[0-7]|10[0-7]|48[;:])[^m]*m/);
      clickRow(component, name);
      const baseline = new ToolExecutionComponent(name, "call:1", args, { showImages: false }, definition, ui, process.cwd());
      baseline.setArgsComplete();
      baseline.markExecutionStarted();
      baseline.updateResult(result);
      baseline.setExpanded(true);
      assert.deepEqual(component.render(40), baseline.render(40));
      clickRow(component, name === "bash" ? "$" : name);
      assert.equal(content(component).length, 1);
      setMobile(false);
      baseline.setExpanded(false);
      assert.deepEqual(component.render(40), baseline.render(40));
      setMobile(true);
      assert.equal(content(component).length, 1);
      assert.deepEqual(result, saved);
    });
  }
}

test("streaming arguments and results stay folded; errors show on the same row", () => {
  const { component } = tool("bash", { command: "npm test\nwith more arguments" }, createBashToolDefinition(process.cwd()) as ToolRenderers);
  component.updateResult({ content: [{ type: "text", text: "partial output\nsecond line" }], isError: false }, true);
  assert.equal(content(component).length, 1);
  assert.match(content(component)[0], /◌/);
  assert.doesNotMatch(content(component)[0], /partial output/);
  component.updateResult({ content: [{ type: "text", text: "Test failed\nstack trace" }], isError: true });
  assert.equal(content(component, 100).length, 1);
  assert.match(content(component, 100)[0], /✗.*Test failed/);
  assert.doesNotMatch(content(component, 100)[0], /stack trace/);
});

test("folded mobile status uses colored icons; expanded pending, success, and error backgrounds return", () => {
  const theme = rendererTheme();
  const definition = createBashToolDefinition(process.cwd()) as ToolRenderers;
  const { component, setMobile } = tool("bash", { command: "npm test" }, definition);
  const background = /\x1b\[(?:4[0-7]|10[0-7]|48[;:])[^m]*m/;
  assert.doesNotMatch(component.render(100).join("\n"), background);
  component.setExpanded(true);
  assert.ok(component.render(100).join("\n").includes(theme.getBgAnsi("toolPendingBg")));
  component.setExpanded(false);
  for (const isError of [false, true]) {
    const result = { content: [{ type: "text", text: isError ? "Test failed" : "Tests passed" }], isError };
    component.updateResult(result);
    const collapsed = component.render(100).join("\n");
    assert.doesNotMatch(collapsed, background);
    assert.ok(collapsed.includes(theme.fg(isError ? "error" : "success", isError ? "✗" : "✓")));
    if (isError) assert.ok(!collapsed.includes(theme.fg("error", " — Test failed")));
    clickRow(component, "bash");
    assert.ok(component.render(100).join("\n").includes(theme.getBgAnsi(isError ? "toolErrorBg" : "toolSuccessBg")));
    clickRow(component, "$");
    setMobile(false);
    const baseline = new ToolExecutionComponent("bash", "call:1", { command: "npm test" }, { showImages: false }, definition, ui, process.cwd());
    baseline.setArgsComplete();
    baseline.markExecutionStarted();
    baseline.updateResult(result);
    assert.deepEqual(component.render(100), baseline.render(100));
    assert.match(component.render(100).join("\n"), background);
    setMobile(true);
    assert.doesNotMatch(component.render(100).join("\n"), background);
  }
});

test("narrow Unicode summaries fit the terminal and disarm control sequences", () => {
  const { component } = tool("read", { path: "中文/👩‍💻/\x1b[31mlong\nfile.ts\x1b[0m" });
  component.updateResult({ content: [{ type: "text", text: "secret output" }], isError: false });
  for (const width of [8, 20, 40]) {
    assert.equal(content(component, width).length, 1);
    assert.ok(component.render(width).every((line) => visibleWidth(line) <= width));
  }
  assert.doesNotMatch(content(component, 100)[0], /\x1b|\n|secret output/);
});

test("custom/codemode renderers retain component caches, details, and native self shells", () => {
  const details = { nestedCalls: [{ name: "read", status: "success" }] };
  const seen: unknown[] = [];
  const original: ToolRenderers = {
    renderShell: "self",
    renderCall(_args, _theme, context) {
      const component = context.lastComponent ?? new Text("script", 0, 0);
      assert.ok(component instanceof Text);
      component.setText(`script ${context.expanded}`);
      seen.push(component);
      return component;
    },
    renderResult(result, _options, _theme, context) {
      assert.equal(result.details, details);
      const component = context.lastComponent ?? new Text("native nested details", 0, 0);
      assert.ok(component instanceof Text);
      return component;
    },
  };
  const { component, setMobile } = tool("codemode", { code: "tools.read(...)" }, original);
  component.updateResult({ content: [{ type: "text", text: "result" }], details, isError: false });
  assert.equal(content(component).length, 1);
  clickRow(component, "codemode");
  assert.match(content(component).join("\n"), /native nested details/);
  const first = seen.at(-1);
  setMobile(false);
  setMobile(true);
  assert.equal(seen.at(-1), first);
  component.setExpanded(false);
  assert.equal(content(component).length, 1);
});

test("HTML exports retain results when call and result renderers are resolved independently", () => {
  const original: ToolRenderers = {
    renderCall: () => new Text("custom call", 0, 0),
    renderResult: (result) => new Text(result.content.map((block) => block.type === "text" ? block.text : "").join("\n"), 0, 0),
  };
  for (const mobile of [false, true]) {
    const html = createToolHtmlRenderer({
      theme: rendererTheme(),
      cwd: process.cwd(),
      getToolRenderers: (name) => compactToolRenderer(name, original, () => mobile, () => {}),
    });
    assert.ok(html.renderCall("call:export", "custom_tool", {}));
    const result = html.renderResult("call:export", "custom_tool", [{ type: "text", text: "preserved result" }], undefined, false);
    assert.match(result?.expanded ?? "", /preserved result/);
  }
});

test("unknown tools have an expandable raw argument/result fallback", () => {
  const { component } = tool("external_tool", { query: "example" });
  component.updateResult({ content: [{ type: "text", text: "external result" }], isError: false });
  assert.equal(content(component).length, 1);
  clickRow(component, "external_tool");
  assert.ok(component.render(40).join("\n").includes(rendererTheme().getBgAnsi("toolSuccessBg")));
  assert.match(content(component).join("\n"), /example/);
  assert.match(content(component).join("\n"), /external result/);
});
