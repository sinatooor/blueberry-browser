import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import {
  projectFilesDir,
  projectOutputsDir,
} from "../projects/sandbox";
import { addFile } from "../projects/store";
import type { CodeOutputChunk, CodeRunResult } from "../../common/types";

let hostWindow: BrowserWindow | null = null;
let warming: Promise<void> | null = null;
let warmed = false;
const pendingRuns = new Map<
  string,
  {
    resolve: (r: CodeRunResult) => void;
    onChunk?: (c: CodeOutputChunk) => void;
    outputs: CodeOutputChunk[];
    projectId: string;
    startedAt: number;
  }
>();

function ensureHandlersWired(): void {
  // Set up IPC listeners that bridge the off-screen window's events back to the runtime.
  // Idempotent.
  if ((globalThis as any).__pyodideWired) return;
  (globalThis as any).__pyodideWired = true;

  ipcMain.on("pyodide:ready-to-warm", () => {
    // Trigger warmup once renderer signals it's ready.
    hostWindow?.webContents.send("pyodide:warmup");
  });

  ipcMain.on("pyodide:warm", (_e, payload: { ok: boolean; error?: string }) => {
    if (payload.ok) {
      warmed = true;
      console.log("[pyodide] warm");
    } else {
      console.warn("[pyodide] warmup failed:", payload.error);
    }
  });

  ipcMain.on(
    "pyodide:output",
    (_e, payload: { runId: string; chunk: CodeOutputChunk }) => {
      const run = pendingRuns.get(payload.runId);
      if (!run) return;
      run.outputs.push(payload.chunk);
      run.onChunk?.(payload.chunk);
    },
  );

  ipcMain.on(
    "pyodide:done",
    (
      _e,
      payload: {
        runId: string;
        ok: boolean;
        error?: string;
        durationMs: number;
        plots?: { kind: "image"; data: string }[];
      },
    ) => {
      const run = pendingRuns.get(payload.runId);
      if (!run) return;
      // Save plots into project outputs/
      const dir = projectOutputsDir(run.projectId);
      fs.mkdirSync(dir, { recursive: true });
      for (const p of payload.plots ?? []) {
        const filename = `plot-${nanoid(6)}.png`;
        const abs = path.join(dir, filename);
        fs.writeFileSync(abs, Buffer.from(p.data, "base64"));
        const stat = fs.statSync(abs);
        addFile({
          projectId: run.projectId,
          path: path.posix.join("..", "outputs", filename), // outputs/ is sibling of files/
          source: "code",
          mime: "image/png",
          bytes: stat.size,
        });
        const chunk: CodeOutputChunk = {
          kind: "image",
          path: abs,
          mime: "image/png",
        };
        run.outputs.push(chunk);
        run.onChunk?.(chunk);
      }
      const done: CodeOutputChunk = {
        kind: "done",
        ok: payload.ok,
        error: payload.error,
        durationMs: payload.durationMs,
      };
      run.outputs.push(done);
      run.onChunk?.(done);

      run.resolve({
        ok: payload.ok,
        error: payload.error,
        outputs: run.outputs,
        durationMs: payload.durationMs,
      });
      pendingRuns.delete(payload.runId);
    },
  );
}

export function createPyodideHost(): void {
  ensureHandlersWired();
  if (hostWindow) return;
  const htmlPath = path.join(__dirname, "../../resources/pyodide-host/index.html");
  // Fallback paths: in dev the resources dir is at project root, in prod inside app.asar.unpacked
  const candidates = [
    htmlPath,
    path.join(app.getAppPath(), "resources/pyodide-host/index.html"),
    path.join(process.cwd(), "resources/pyodide-host/index.html"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    console.warn("[pyodide] index.html not found in", candidates);
  }
  // Locate the preload alongside the html.
  const preloadCandidates = candidates.map((c) =>
    path.join(path.dirname(c), "preload.js"),
  );
  const preloadPath = preloadCandidates.find((p) => fs.existsSync(p)) ?? "";
  hostWindow = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: {
      // Pyodide must NOT see Node — it auto-detects and tries to import
      // node:url. We expose IPC through a preload bridge instead.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath || undefined,
    },
  });
  if (found) {
    hostWindow.loadFile(found);
  }
  hostWindow.on("closed", () => {
    hostWindow = null;
    warmed = false;
  });
}

export async function warmupPyodide(): Promise<void> {
  if (warmed) return;
  if (!hostWindow) createPyodideHost();
  if (warming) return warming;
  warming = new Promise<void>((resolve) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      if (warmed) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - t0 > 60_000) {
        clearInterval(id);
        console.warn("[pyodide] warmup timed out");
        resolve();
      }
    }, 250);
  });
  return warming;
}

export function isPyodideReady(): boolean {
  return warmed;
}

export async function runPython(
  source: string,
  projectId: string,
  onChunk?: (c: CodeOutputChunk) => void,
): Promise<CodeRunResult> {
  if (!hostWindow) createPyodideHost();
  if (!warmed) await warmupPyodide();
  if (!hostWindow || !warmed) {
    return {
      ok: false,
      error: "Pyodide not available",
      outputs: [],
      durationMs: 0,
    };
  }

  // Read project files so the sandbox sees them at /project/files/
  const filesDir = projectFilesDir(projectId);
  const projectFiles: { name: string; bytes: Buffer }[] = [];
  try {
    for (const name of fs.readdirSync(filesDir)) {
      const abs = path.join(filesDir, name);
      const st = fs.statSync(abs);
      if (st.isFile() && st.size < 8 * 1024 * 1024) {
        projectFiles.push({ name, bytes: fs.readFileSync(abs) });
      }
    }
  } catch {
    /* directory may not exist yet */
  }

  return new Promise((resolve) => {
    const runId = `code_${nanoid(10)}`;
    pendingRuns.set(runId, {
      resolve,
      onChunk,
      outputs: [],
      projectId,
      startedAt: Date.now(),
    });
    hostWindow!.webContents.send("pyodide:run", {
      runId,
      code: source,
      projectFiles: projectFiles.map((f) => ({ name: f.name, bytes: f.bytes })),
    });
    // Hard timeout
    setTimeout(() => {
      const run = pendingRuns.get(runId);
      if (!run) return;
      pendingRuns.delete(runId);
      resolve({
        ok: false,
        error: "Code run timed out (30s)",
        outputs: run.outputs,
        durationMs: Date.now() - run.startedAt,
      });
    }, 30_000);
  });
}
