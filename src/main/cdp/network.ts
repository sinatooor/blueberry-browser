import type { WebContents } from "electron";
import { nanoid } from "nanoid";
import { attach, send, onEvent } from "./attach";
import { persistNetRequest } from "../projects/store";
import type { NetRequest } from "../../common/types";

const SENSITIVE_HEADER_PATTERNS = [
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /-token$/i,
  /^x-api-key$/i,
  /^x-csrf-token$/i,
];

const ASSET_RESOURCE_TYPES = new Set([
  "Image",
  "Font",
  "Stylesheet",
  "Media",
  "Manifest",
  "TextTrack",
]);

function stripSensitive(headers: Record<string, string> | undefined): {
  safe: Record<string, string>;
  stripped: string[];
} {
  if (!headers) return { safe: {}, stripped: [] };
  const safe: Record<string, string> = {};
  const stripped: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_PATTERNS.some((p) => p.test(k))) {
      stripped.push(k);
      safe[k] = "<redacted>";
    } else {
      safe[k] = v;
    }
  }
  return { safe, stripped };
}

type Pending = {
  id: string;
  cdpRequestId: string;
  request: NetRequest;
};

export class NetworkCapture {
  private buffer: NetRequest[] = [];
  private capacity = 500;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(req: NetRequest) => void>();
  private detachers = new WeakMap<WebContents, () => void>();
  private currentTabId = "";
  private currentProjectId: string | undefined;

  setActiveTab(tabId: string, projectId: string | undefined): void {
    this.currentTabId = tabId;
    this.currentProjectId = projectId;
  }

  onRequest(fn: (req: NetRequest) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(opts?: { tabId?: string; limit?: number }): NetRequest[] {
    let out = this.buffer;
    if (opts?.tabId) out = out.filter((r) => r.tabId === opts.tabId);
    return out.slice(-(opts?.limit ?? 200)).reverse();
  }

  get(id: string): NetRequest | null {
    return this.buffer.find((r) => r.id === id) ?? null;
  }

  clear(): void {
    this.buffer = [];
    this.pending.clear();
  }

  attachToWebContents(wc: WebContents, tabId: string): void {
    if (this.detachers.has(wc)) return;
    attach(wc);
    send(wc, "Network.enable", { maxTotalBufferSize: 10 * 1024 * 1024 }).catch(() => {});

    const off = onEvent(wc, async (method, params) => {
      try {
        if (method === "Network.requestWillBeSent") {
          const p = params as {
            requestId: string;
            request: { url: string; method: string; headers: Record<string, string>; postData?: string };
            type?: string;
            timestamp: number;
          };
          if (p.type && ASSET_RESOURCE_TYPES.has(p.type)) return;
          const id = nanoid(10);
          const { safe } = stripSensitive(p.request.headers);
          const req: NetRequest = {
            id,
            tabId,
            projectId: this.currentTabId === tabId ? this.currentProjectId : undefined,
            method: p.request.method,
            url: p.request.url,
            resourceType: p.type,
            reqHeaders: safe,
            reqBody: p.request.postData,
            ts: Date.now(),
          };
          this.pending.set(p.requestId, { id, cdpRequestId: p.requestId, request: req });
        } else if (method === "Network.responseReceived") {
          const p = params as {
            requestId: string;
            response: { status: number; headers: Record<string, string>; mimeType?: string };
          };
          const pending = this.pending.get(p.requestId);
          if (!pending) return;
          pending.request.status = p.response.status;
          const { safe } = stripSensitive(p.response.headers);
          pending.request.resHeaders = safe;
        } else if (method === "Network.loadingFinished") {
          const p = params as { requestId: string };
          const pending = this.pending.get(p.requestId);
          if (!pending) return;
          // Lazily fetch body for JSON/text only
          const mime = pending.request.resHeaders?.["content-type"] ?? pending.request.resHeaders?.["Content-Type"] ?? "";
          if (
            !pending.request.resourceType ||
            ["XHR", "Fetch", "Document", "Script"].includes(pending.request.resourceType)
          ) {
            try {
              const { body, base64Encoded } = await send<{
                body: string;
                base64Encoded: boolean;
              }>(wc, "Network.getResponseBody", { requestId: p.requestId });
              if (!base64Encoded) {
                if (body.length > 256_000) {
                  pending.request.resBody = body.slice(0, 256_000);
                  pending.request.resBodyTruncated = true;
                } else {
                  pending.request.resBody = body;
                }
              } else if (mime.startsWith("text") || mime.includes("json")) {
                pending.request.resBody = Buffer.from(body, "base64").toString("utf8").slice(0, 256_000);
              }
            } catch {
              /* body unavailable for this request */
            }
          }
          this.commit(pending.request);
          this.pending.delete(p.requestId);
        } else if (method === "Network.loadingFailed") {
          const p = params as { requestId: string };
          const pending = this.pending.get(p.requestId);
          if (pending) {
            this.commit(pending.request);
            this.pending.delete(p.requestId);
          }
        }
      } catch (err) {
        console.warn("[net] handler error:", (err as Error).message);
      }
    });

    this.detachers.set(wc, off);
  }

  detachFromWebContents(wc: WebContents): void {
    const d = this.detachers.get(wc);
    if (d) d();
  }

  private commit(req: NetRequest): void {
    this.buffer.push(req);
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity);
    }
    if (req.projectId) {
      try {
        persistNetRequest(req);
      } catch (e) {
        console.warn("[net] persist failed:", (e as Error).message);
      }
    }
    for (const l of this.listeners) l(req);
  }
}

export const networkCapture = new NetworkCapture();
