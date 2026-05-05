// Page-side helpers that built extensions can use, plus the main-side bridge
// that wires them.
//
// What this gives the page (every tab, every navigation):
//   - window.__bb_widget(id, title, body)
//       Creates a draggable, closeable floating panel with `bb-*` id. Position
//       persists to localStorage. Returns the inner content slot so callers
//       can populate it with DOM nodes.
//   - window.__bb_runPython(code)
//       Returns a Promise<{ stdout, stderr, plots: [{dataUrl}], value }>.
//       Pyodide runs in main; the main-side bridge marshals the result back
//       via Runtime.evaluate.
//
// How: we register a CDP binding `__bb_pyrun`. The page-side helper calls
// the binding with a JSON payload {id, code}; main runs Pyodide; main calls
// `Runtime.evaluate` on `window.__bb._pyresolve(JSON.stringify(...))` to
// resolve the matching pending promise on the page.

import type { WebContents } from "electron";
import fs from "node:fs";
import { attach, send, onEvent } from "./attach";
import { runPython } from "../code/pyodide-host";

let activeProjectIdResolver: () => string | null = () => null;

// Wired once from ipc/handlers when the workbench IPC registers.
export function setActiveProjectIdResolver(fn: () => string | null): void {
  activeProjectIdResolver = fn;
}

const BINDING_NAME = "__bb_pyrun";
const wired = new WeakSet<WebContents>();

// Big, but inline-stringified so it ships with the main bundle and
// runs before any page script via Page.addScriptToEvaluateOnNewDocument.
const PAGE_HELPERS = String.raw`
(function () {
  if (window.__bb) return;
  var __bb = (window.__bb = {});

  // ----- Floating widget shell -----
  __bb.widget = function (id, title, body) {
    if (!/^bb-[a-z0-9-]/i.test(id)) throw new Error('widget id must start with "bb-"');
    var root = document.getElementById(id);
    if (root) {
      var slotExisting = root.querySelector('[data-bb-slot]');
      if (slotExisting && body !== undefined) {
        if (typeof body === 'string') slotExisting.innerHTML = body;
        else if (body instanceof Node) { slotExisting.innerHTML = ''; slotExisting.appendChild(body); }
      }
      return slotExisting || root;
    }
    root = document.createElement('div');
    root.id = id;
    var dark = document.documentElement.classList.contains('dark');
    var bg = dark ? 'rgba(20,20,20,0.95)' : 'rgba(255,255,255,0.97)';
    var fg = dark ? '#f0f0f0' : '#1a1a1a';
    var border = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    Object.assign(root.style, {
      position: 'fixed',
      top: '24px',
      right: '24px',
      width: 'min(420px, 90vw)',
      maxHeight: '80vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      zIndex: '2147483640',
      background: bg,
      color: fg,
      borderRadius: '12px',
      boxShadow: '0 12px 48px rgba(0,0,0,0.32)',
      border: '1px solid ' + border,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '13px',
      backdropFilter: 'blur(8px)',
    });

    try {
      var stored = localStorage.getItem('bb:widget-pos:' + id);
      if (stored) {
        var p = JSON.parse(stored);
        if (typeof p.left === 'number' && typeof p.top === 'number') {
          root.style.left = p.left + 'px';
          root.style.top = p.top + 'px';
          root.style.right = 'auto';
        }
      }
    } catch (e) {}

    var header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 12px',
      borderBottom: '1px solid ' + border,
      cursor: 'move',
      userSelect: 'none',
      flexShrink: '0',
    });
    var titleEl = document.createElement('div');
    titleEl.textContent = title || id;
    Object.assign(titleEl.style, {
      flex: '1',
      fontWeight: '600',
      fontSize: '12px',
      letterSpacing: '0.02em',
    });
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    Object.assign(closeBtn.style, {
      background: 'transparent',
      border: 'none',
      color: 'inherit',
      fontSize: '18px',
      cursor: 'pointer',
      lineHeight: '1',
      padding: '0 4px',
      opacity: '0.65',
    });
    closeBtn.addEventListener('click', function () { root && root.remove(); });
    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    var dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', function (e) {
      if (e.target === closeBtn) return;
      dragging = true;
      var rect = root.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      root.style.right = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - ox));
      var top = Math.max(0, Math.min(window.innerHeight - 32, e.clientY - oy));
      root.style.left = left + 'px';
      root.style.top = top + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      try {
        var rect = root.getBoundingClientRect();
        localStorage.setItem('bb:widget-pos:' + id, JSON.stringify({ left: rect.left, top: rect.top }));
      } catch (e) {}
    });

    var slot = document.createElement('div');
    slot.setAttribute('data-bb-slot', 'true');
    Object.assign(slot.style, { padding: '12px', overflow: 'auto', flex: '1' });
    if (typeof body === 'string') slot.innerHTML = body;
    else if (body instanceof Node) slot.appendChild(body);

    root.appendChild(header);
    root.appendChild(slot);
    document.body.appendChild(root);
    return slot;
  };

  // ----- Python bridge -----
  __bb._pendingPy = new Map();
  __bb.runPython = function (code) {
    return new Promise(function (resolve, reject) {
      var id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      __bb._pendingPy.set(id, { resolve: resolve, reject: reject });
      try {
        if (typeof window.${BINDING_NAME} !== 'function') {
          __bb._pendingPy.delete(id);
          reject(new Error('Python bridge not available'));
          return;
        }
        window.${BINDING_NAME}(JSON.stringify({ id: id, code: code }));
      } catch (e) {
        __bb._pendingPy.delete(id);
        reject(e);
      }
    });
  };
  __bb._pyresolve = function (payload) {
    var parsed;
    try { parsed = JSON.parse(payload); } catch (e) { return; }
    var p = __bb._pendingPy.get(parsed.id);
    if (!p) return;
    __bb._pendingPy.delete(parsed.id);
    if (parsed.ok) p.resolve(parsed.result);
    else p.reject(new Error(parsed.error || 'Python run failed'));
  };

  // Convenience aliases (the LLM is taught these names).
  window.__bb_widget = __bb.widget;
  window.__bb_runPython = __bb.runPython;
})();
`;

export function attachPageBridge(wc: WebContents): void {
  if (wired.has(wc)) return;
  wired.add(wc);

  attach(wc);

  // Register the binding + inject helpers on every new document.
  void send(wc, "Runtime.enable").catch(() => {});
  void send(wc, "Page.enable").catch(() => {});
  void send(wc, "Runtime.addBinding", { name: BINDING_NAME }).catch((e) => {
    console.warn("[page-bridge] addBinding failed:", (e as Error).message);
  });
  void send(wc, "Page.addScriptToEvaluateOnNewDocument", {
    source: PAGE_HELPERS,
  }).catch((e) => {
    console.warn("[page-bridge] addScript failed:", (e as Error).message);
  });

  // Re-arm on navigations: addBinding can drop on context destroy.
  wc.on("did-navigate", () => {
    void send(wc, "Runtime.addBinding", { name: BINDING_NAME }).catch(() => {});
  });

  // Listen for binding calls.
  onEvent(wc, async (method, params) => {
    if (method !== "Runtime.bindingCalled") return;
    const p = params as { name?: string; payload?: string };
    if (p.name !== BINDING_NAME) return;
    let req: { id: string; code: string };
    try {
      req = JSON.parse(p.payload ?? "{}");
    } catch {
      return;
    }
    const projectId = activeProjectIdResolver();
    if (!projectId) {
      respond(wc, req.id, { ok: false, error: "No active project for Python run" });
      return;
    }
    try {
      const result = await runPython(req.code, projectId);
      const stdout = collect(result.outputs, "stdout");
      const stderr = collect(result.outputs, "stderr");
      const plots = await readPlots(result.outputs);
      const value = result.outputs.find((o) => o.kind === "result");
      respond(wc, req.id, {
        ok: result.ok,
        error: result.error,
        result: {
          stdout,
          stderr,
          plots,
          value:
            value && value.kind === "result" ? (value as { value: string }).value : undefined,
        },
      });
    } catch (e) {
      respond(wc, req.id, {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}

function respond(
  wc: WebContents,
  id: string,
  payload: { ok: boolean; result?: unknown; error?: string },
): void {
  const json = JSON.stringify({ id, ...payload });
  const expr = `window.__bb && window.__bb._pyresolve(${JSON.stringify(json)});`;
  void send(wc, "Runtime.evaluate", {
    expression: expr,
    awaitPromise: false,
  }).catch(() => {});
}

function collect(
  outputs: Array<{ kind: string; text?: string }>,
  kind: string,
): string {
  return outputs
    .filter((o) => o.kind === kind)
    .map((o) => (typeof o.text === "string" ? o.text : ""))
    .join("");
}

async function readPlots(
  outputs: Array<{ kind: string; path?: string; mime?: string }>,
): Promise<Array<{ dataUrl: string; mime: string }>> {
  const out: Array<{ dataUrl: string; mime: string }> = [];
  for (const o of outputs) {
    if (o.kind !== "image" || !o.path) continue;
    try {
      const buf = fs.readFileSync(o.path);
      const mime = o.mime ?? "image/png";
      out.push({
        mime,
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      });
    } catch {
      // file missing — skip
    }
  }
  return out;
}
