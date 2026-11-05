import { performance } from "node:perf_hooks";
import { createBashToolDefinition, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, ScrollView } from "@earendil-works/pi-tui";
import { renderLayoutFrame } from "../node_modules/@earendil-works/pi-tui/dist/layout.js";
import { compactToolRenderer } from "../src/render.ts";

initTheme("dark", false);
const width = 40;
const height = 24;
const ui = { requestRender() {} };
const result = {
  content: [{ type: "text", text: Array.from({ length: 100 }, (_, i) =>
    `line ${i}: representative test output and some 中文 content`).join("\n") }],
  isError: false,
  durationMs: 25,
};

for (const count of [1000, 5000]) {
  for (const mode of ["native", "summary", "preview"]) {
    const original = createBashToolDefinition(process.cwd());
    const renderer = mode === "native" ? original
      : compactToolRenderer("bash", original, () => true, () => {}, () => false);
    const document = new Container();
    for (let i = 0; i < count; i++) {
      const tool = new ToolExecutionComponent("bash", `call:${i}`, { command: `npm test -- case-${i}` },
        { showImages: false }, renderer, ui, process.cwd());
      tool.updateResult(result);
      if (mode === "preview") {
        const lines = tool.render(width);
        const click = tool.handleMouse({ type: "click", button: "left", x: 2, y: 1, screenX: 2, screenY: 1,
          width, height: lines.length, shift: false, alt: false, ctrl: false });
        if (!click?.handled) throw new Error("Preview click was not handled");
      }
      document.addChild(tool);
    }
    const scroll = new ScrollView(document, { follow: "end" });
    const render = () => renderLayoutFrame(scroll, width, height, () => {});
    const start = performance.now();
    render();
    const firstFrameMs = performance.now() - start;
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      render();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ count, mode, width, height,
      firstFrameMs: +firstFrameMs.toFixed(2),
      medianWarmMs: +samples[Math.floor(samples.length / 2)].toFixed(2),
      p95WarmMs: +samples[Math.floor(samples.length * 0.95)].toFixed(2),
    }));
  }
}
