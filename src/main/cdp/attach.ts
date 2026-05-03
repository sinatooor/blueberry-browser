import type { WebContents } from "electron";

const attached = new WeakSet<WebContents>();

export function isAttached(wc: WebContents): boolean {
  return attached.has(wc) && wc.debugger.isAttached();
}

export function attach(wc: WebContents): void {
  if (isAttached(wc)) return;
  try {
    wc.debugger.attach("1.3");
    attached.add(wc);
  } catch (err) {
    // Common failure: another debugger is already attached (e.g. user opened DevTools).
    console.warn("[cdp] attach failed:", (err as Error).message);
    return;
  }

  wc.debugger.on("detach", () => {
    attached.delete(wc);
  });

  // Re-attach gracefully on navigation if it gets detached.
  wc.on("did-navigate", () => {
    if (!isAttached(wc)) {
      try {
        wc.debugger.attach("1.3");
        attached.add(wc);
      } catch {
        /* ignore */
      }
    }
  });
}

export function detach(wc: WebContents): void {
  if (!isAttached(wc)) return;
  try {
    wc.debugger.detach();
  } catch {
    /* ignore */
  }
  attached.delete(wc);
}

export async function send<T = unknown>(
  wc: WebContents,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  if (!isAttached(wc)) attach(wc);
  return (await wc.debugger.sendCommand(method, params ?? {})) as T;
}

export function onEvent(
  wc: WebContents,
  handler: (method: string, params: unknown) => void,
): () => void {
  const fn = (_e: Electron.Event, method: string, params: unknown): void => {
    handler(method, params);
  };
  wc.debugger.on("message", fn);
  return () => wc.debugger.off("message", fn);
}
