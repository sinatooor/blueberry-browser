import type { WebContents } from "electron";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { attach, send } from "./attach";

export type ActionOk<T> = { ok: true } & T;
export type ActionErr = { ok: false; error: string };
export type ActionResult<T> = ActionOk<T> | ActionErr;

async function ensureRoot(wc: WebContents): Promise<number> {
  await send(wc, "DOM.enable");
  await send(wc, "DOM.disable").catch(() => {}); // reset
  await send(wc, "DOM.enable");
  const { root } = await send<{ root: { nodeId: number } }>(wc, "DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  return root.nodeId;
}

async function nodeIdForSelector(wc: WebContents, selector: string): Promise<number | null> {
  const rootId = await ensureRoot(wc);
  try {
    const { nodeId } = await send<{ nodeId: number }>(wc, "DOM.querySelector", {
      nodeId: rootId,
      selector,
    });
    return nodeId || null;
  } catch {
    return null;
  }
}

async function getCenter(
  wc: WebContents,
  nodeId: number,
): Promise<{ x: number; y: number; bbox: [number, number, number, number] } | null> {
  try {
    const { model } = await send<{
      model: { content: number[]; width: number; height: number };
    }>(wc, "DOM.getBoxModel", { nodeId });
    const c = model.content;
    // content polygon: [x1,y1,x2,y2,x3,y3,x4,y4]
    const x = (c[0] + c[2] + c[4] + c[6]) / 4;
    const y = (c[1] + c[3] + c[5] + c[7]) / 4;
    const minX = Math.min(c[0], c[2], c[4], c[6]);
    const minY = Math.min(c[1], c[3], c[5], c[7]);
    return { x, y, bbox: [minX, minY, model.width, model.height] };
  } catch {
    return null;
  }
}

export async function click(
  wc: WebContents,
  selector: string,
): Promise<ActionResult<{ bbox: [number, number, number, number] }>> {
  attach(wc);
  const nodeId = await nodeIdForSelector(wc, selector);
  if (!nodeId) return { ok: false, error: `selector not found: ${selector}` };
  await send(wc, "DOM.scrollIntoViewIfNeeded", { nodeId }).catch(() => {});
  const center = await getCenter(wc, nodeId);
  if (!center) return { ok: false, error: `no box for: ${selector}` };
  await send(wc, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: center.x,
    y: center.y,
  });
  await send(wc, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
  await send(wc, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: center.x,
    y: center.y,
    button: "left",
    clickCount: 1,
  });
  return { ok: true, bbox: center.bbox };
}

export async function type(
  wc: WebContents,
  selector: string,
  text: string,
): Promise<ActionResult<{}>> {
  attach(wc);
  const nodeId = await nodeIdForSelector(wc, selector);
  if (!nodeId) return { ok: false, error: `selector not found: ${selector}` };
  await send(wc, "DOM.focus", { nodeId }).catch(() => {});
  // Use Input.insertText so non-ASCII works
  await send(wc, "Input.insertText", { text });
  return { ok: true };
}

export async function scroll(
  wc: WebContents,
  direction: "up" | "down",
  px: number,
): Promise<ActionResult<{}>> {
  attach(wc);
  const dy = direction === "down" ? px : -px;
  await send(wc, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: 100,
    y: 100,
    deltaX: 0,
    deltaY: dy,
  });
  return { ok: true };
}

export async function navigate(
  wc: WebContents,
  url: string,
): Promise<ActionResult<{}>> {
  await wc.loadURL(url);
  return { ok: true };
}

export async function waitForSelector(
  wc: WebContents,
  selector: string,
  timeoutMs = 8000,
): Promise<ActionResult<{}>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const nodeId = await nodeIdForSelector(wc, selector);
    if (nodeId) return { ok: true };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: `timeout waiting for ${selector}` };
}

export async function extractText(
  wc: WebContents,
  selector: string,
): Promise<ActionResult<{ text: string }>> {
  attach(wc);
  const nodeId = await nodeIdForSelector(wc, selector);
  if (!nodeId) return { ok: false, error: `selector not found: ${selector}` };
  try {
    const { outerHTML } = await send<{ outerHTML: string }>(wc, "DOM.getOuterHTML", {
      nodeId,
    });
    const text = outerHTML
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function screenshot(
  wc: WebContents,
  saveDir: string,
  label: string,
): Promise<ActionResult<{ path: string }>> {
  attach(wc);
  try {
    const { data } = await send<{ data: string }>(wc, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    fs.mkdirSync(saveDir, { recursive: true });
    const file = path.join(saveDir, `${label}-${nanoid(6)}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    return { ok: true, path: file };
  } catch (e) {
    // Fallback: use Electron's built-in capturePage
    try {
      const img = await wc.capturePage();
      const file = path.join(saveDir, `${label}-${nanoid(6)}.png`);
      fs.mkdirSync(saveDir, { recursive: true });
      fs.writeFileSync(file, img.toPNG());
      return { ok: true, path: file };
    } catch (e2) {
      return { ok: false, error: (e2 as Error).message };
    }
  }
}

export async function evalJs(
  wc: WebContents,
  source: string,
  awaitPromise = true,
  timeoutMs = 8_000,
): Promise<ActionResult<{ value: unknown }>> {
  attach(wc);
  try {
    type EvalRes = {
      result: { type: string; value?: unknown; description?: string };
      exceptionDetails?: {
        text?: string;
        exception?: { description?: string; value?: unknown };
      };
    };
    // Wrap user code in an IIFE so they can use top-level `await`, and race
    // it against a setTimeout reject so a hung script can't block the agent.
    const expression = `Promise.race([
      (async () => { ${source}\n })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("evalJs timed out after ${timeoutMs}ms")), ${timeoutMs}))
    ])`;
    const res = await send<EvalRes>(wc, "Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (res.exceptionDetails) {
      const ex = res.exceptionDetails;
      const msg =
        ex.exception?.description ??
        (typeof ex.exception?.value === "string" ? ex.exception.value : null) ??
        ex.text ??
        "JavaScript exception";
      return { ok: false, error: msg };
    }
    return { ok: true, value: res.result?.value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function getOuterHtml(wc: WebContents, selector: string): Promise<string | null> {
  const nodeId = await nodeIdForSelector(wc, selector);
  if (!nodeId) return null;
  try {
    const { outerHTML } = await send<{ outerHTML: string }>(wc, "DOM.getOuterHTML", {
      nodeId,
    });
    return outerHTML;
  } catch {
    return null;
  }
}
