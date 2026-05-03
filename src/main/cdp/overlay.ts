import type { WebContents } from "electron";
import { send } from "./attach";

const HIGHLIGHT = {
  showInfo: false,
  contentColor: { r: 56, g: 189, b: 248, a: 0.25 }, // sky-400 @ 25%
  paddingColor: { r: 56, g: 189, b: 248, a: 0.15 },
  borderColor: { r: 14, g: 116, b: 144, a: 0.95 }, // cyan-700
  marginColor: { r: 56, g: 189, b: 248, a: 0.1 },
};

export async function highlight(
  wc: WebContents,
  selector: string,
  durationMs = 400,
): Promise<void> {
  try {
    await send(wc, "Overlay.enable");
    await send(wc, "DOM.enable");
    const { root } = await send<{ root: { nodeId: number } }>(wc, "DOM.getDocument", {
      depth: 0,
    });
    const { nodeId } = await send<{ nodeId: number }>(wc, "DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    });
    if (!nodeId) return;
    await send(wc, "Overlay.highlightNode", {
      highlightConfig: HIGHLIGHT,
      nodeId,
    });
    await new Promise((r) => setTimeout(r, durationMs));
  } catch {
    /* overlay best-effort */
  } finally {
    try {
      await send(wc, "Overlay.hideHighlight");
    } catch {
      /* ignore */
    }
  }
}
