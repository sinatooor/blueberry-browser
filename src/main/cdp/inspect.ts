// Page-structure survey + post-injection collision check used by the agent's
// "inspect → implement → verify" loop. Both helpers are pure CDP calls — they
// run a single Runtime.evaluate against the live page and return JSON the
// model can reason over directly.

import type { WebContents } from "electron";
import { send, attach } from "./attach";

export type FixedRegion = {
  tag: string;
  id: string | null;
  classes: string;
  role: "header" | "nav" | "footer" | "aside" | "main" | "other";
  position: "fixed" | "sticky";
  zIndex: number | null;
  bbox: { x: number; y: number; width: number; height: number };
};

export type InjectedElement = {
  id: string;
  bbox: { x: number; y: number; width: number; height: number };
};

export type PageSurvey = {
  url: string;
  title: string;
  viewport: { width: number; height: number; dpr: number };
  scroll: { x: number; y: number; pageHeight: number };
  theme: {
    backgroundColor: string;
    color: string;
    fontFamily: string;
    fontSize: string;
    colorScheme: string;
    // Derived from background-color luminance — what the page LOOKS like.
    apparentTheme: "light" | "dark" | "mixed";
  };
  fixedRegions: FixedRegion[];
  maxZIndex: number;
  existingInjected: InjectedElement[];
  frameworks: { tailwind: boolean; bootstrap: boolean; mui: boolean };
  // Useful anchor selectors the agent can mount things next to without
  // colliding with `position: fixed` chrome.
  anchors: { body: boolean; main: string | null; header: string | null; footer: string | null };
  // True when the page-settle wait timed out before the DOM stopped mutating.
  // Agent can choose to wait + re-inspect.
  settleTimedOut: boolean;
};

// SETTLE_MS / SETTLE_BUDGET_MS gate inspectPage on the DOM being quiet — covers
// the React-still-mounting case that produced empty fixedRegions before.
const SURVEY_JS = String.raw`(async () => {
  const SETTLE_MS = 350;
  const SETTLE_BUDGET_MS = 3000;
  const round = (n) => Math.round(n);
  const safeRect = (r) => ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) });

  // Phase 1: wait for readyState to be at least 'interactive'.
  const waitReady = () => new Promise((resolve) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return resolve();
    document.addEventListener('readystatechange', () => {
      if (document.readyState === 'complete' || document.readyState === 'interactive') resolve();
    }, { once: true });
  });
  await Promise.race([waitReady(), new Promise((r) => setTimeout(r, 1500))]);

  // Phase 2: wait until the DOM has been quiet for SETTLE_MS, capped at SETTLE_BUDGET_MS.
  let settleTimedOut = false;
  await new Promise((resolve) => {
    const start = Date.now();
    let lastMutation = Date.now();
    const target = document.documentElement;
    if (!target || typeof MutationObserver === 'undefined') return resolve();
    const observer = new MutationObserver(() => { lastMutation = Date.now(); });
    observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
    const tick = () => {
      const now = Date.now();
      if (now - lastMutation >= SETTLE_MS) { observer.disconnect(); return resolve(); }
      if (now - start >= SETTLE_BUDGET_MS) { settleTimedOut = true; observer.disconnect(); return resolve(); }
      setTimeout(tick, 100);
    };
    setTimeout(tick, 100);
  });

  const docEl = document.documentElement;
  const body = document.body;
  const bodyStyle = body ? getComputedStyle(body) : null;
  const docStyle = getComputedStyle(docEl);

  // Apparent theme from background luminance (relative-luminance per WCAG).
  const luminance = (rgbStr) => {
    if (!rgbStr) return 1;
    const m = rgbStr.match(/\d+(?:\.\d+)?/g);
    if (!m || m.length < 3) return 1;
    const lin = (v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(+m[0]) + 0.7152 * lin(+m[1]) + 0.0722 * lin(+m[2]);
  };
  const bgLum = luminance(bodyStyle ? bodyStyle.backgroundColor : '');
  const apparentTheme = bgLum < 0.18 ? 'dark' : bgLum > 0.7 ? 'light' : 'mixed';

  let maxZ = 0;
  const regions = [];
  const all = document.querySelectorAll("body *");
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (!(el instanceof Element)) continue;
    const cs = getComputedStyle(el);
    const z = parseInt(cs.zIndex, 10);
    if (!Number.isNaN(z) && Number.isFinite(z)) maxZ = Math.max(maxZ, z);
    if (cs.position !== "fixed" && cs.position !== "sticky") continue;
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const b = el.getBoundingClientRect();
    if (b.width < 24 || b.height < 24) continue;
    const tag = el.tagName.toLowerCase();
    const role =
      tag === "header" ? "header" :
      tag === "nav" ? "nav" :
      tag === "footer" ? "footer" :
      tag === "aside" ? "aside" :
      tag === "main" ? "main" : "other";
    regions.push({
      tag,
      id: el.id || null,
      classes: (el.className || "").toString().slice(0, 80),
      role,
      position: cs.position,
      zIndex: Number.isNaN(z) ? null : z,
      bbox: safeRect(b),
    });
    if (regions.length >= 24) break;
  }

  // Existing bb-* injections — return id + bbox so the agent can avoid placing
  // a second augmentation on top of the first.
  const existing = Array.from(document.querySelectorAll('[id^="bb-"]')).map((e) => ({
    id: e.id,
    bbox: safeRect(e.getBoundingClientRect()),
  }));

  const hasTailwind = !!document.querySelector(
    '[class*="text-gray-"], [class*="bg-blue-"], [class*="px-"], [class*="py-"], [class*="rounded-"]'
  );
  const hasBootstrap = !!document.querySelector('.btn, .container, .row, [class^="col-"]');
  const hasMUI = !!document.querySelector('[class*="MuiBox"], [class*="MuiButton"], [class*="MuiTypography"]');

  const main = document.querySelector("main");
  const header = document.querySelector("header");
  const footer = document.querySelector("footer");

  return {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
    scroll: {
      x: window.scrollX,
      y: window.scrollY,
      pageHeight: Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0),
    },
    theme: {
      backgroundColor: bodyStyle ? bodyStyle.backgroundColor : "",
      color: bodyStyle ? bodyStyle.color : "",
      fontFamily: bodyStyle ? bodyStyle.fontFamily.slice(0, 100) : "",
      fontSize: bodyStyle ? bodyStyle.fontSize : "",
      colorScheme: docStyle.colorScheme || "",
      apparentTheme,
    },
    fixedRegions: regions,
    maxZIndex: maxZ,
    existingInjected: existing,
    frameworks: { tailwind: hasTailwind, bootstrap: hasBootstrap, mui: hasMUI },
    anchors: {
      body: !!body,
      main: main ? (main.id ? "#" + main.id : "main") : null,
      header: header ? (header.id ? "#" + header.id : "header") : null,
      footer: footer ? (footer.id ? "#" + footer.id : "footer") : null,
    },
    settleTimedOut,
  };
})()`;

export type InspectResult =
  | { ok: true; survey: PageSurvey }
  | { ok: false; error: string };

// Dense plain-text digest of the survey. The full PageSurvey JSON gets sliced
// to 1500 chars by the message-history truncator and loses fixedRegions; this
// digest is ~400 chars and stays intact.
export function summarizeSurvey(s: PageSurvey): string {
  const lines: string[] = [];
  lines.push(`viewport: ${s.viewport.width}x${s.viewport.height} dpr=${s.viewport.dpr}`);
  lines.push(
    `theme: ${s.theme.apparentTheme} bg=${s.theme.backgroundColor || "?"} fg=${s.theme.color || "?"} font="${(s.theme.fontFamily || "?").slice(0, 40)}"`,
  );
  lines.push(`maxZ=${s.maxZIndex} ${s.settleTimedOut ? "(settle TIMED OUT — page still mutating)" : ""}`.trim());
  if (s.fixedRegions.length === 0) {
    lines.push("fixedRegions: none");
  } else {
    lines.push(`fixedRegions (${s.fixedRegions.length}):`);
    for (const r of s.fixedRegions.slice(0, 8)) {
      const idCls = r.id ? `#${r.id}` : r.classes ? `.${r.classes.split(/\s+/)[0]}` : "";
      lines.push(
        `  - ${r.tag}${idCls} ${r.position} z=${r.zIndex ?? "auto"} [${r.bbox.x},${r.bbox.y} ${r.bbox.width}x${r.bbox.height}]`,
      );
    }
  }
  if (s.existingInjected.length > 0) {
    lines.push(`prior bb-* (${s.existingInjected.length}):`);
    for (const e of s.existingInjected.slice(0, 6)) {
      lines.push(`  - #${e.id} [${e.bbox.x},${e.bbox.y} ${e.bbox.width}x${e.bbox.height}]`);
    }
  }
  const fw = Object.entries(s.frameworks)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (fw.length) lines.push(`frameworks: ${fw.join(", ")}`);
  const an = [s.anchors.main, s.anchors.header, s.anchors.footer].filter(Boolean).join(", ");
  if (an) lines.push(`anchors: ${an}`);
  return lines.join("\n");
}

export async function inspectPage(wc: WebContents): Promise<InspectResult> {
  attach(wc);
  try {
    type EvalRes = {
      result: { type: string; value?: PageSurvey; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    const res = await send<EvalRes>(wc, "Runtime.evaluate", {
      expression: SURVEY_JS,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      return {
        ok: false,
        error:
          res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          "Survey JS threw",
      };
    }
    if (!res.result?.value) {
      return { ok: false, error: "Survey returned no value" };
    }
    return { ok: true, survey: res.result.value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type OverlayCheck = {
  found: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  inViewport?: boolean;
  visible?: boolean;
  zIndex?: number;
  conflicts?: {
    tag: string;
    id: string | null;
    classes: string;
    bbox: { x: number; y: number; width: number; height: number };
    overlapPx: number;
    otherZ: number;
    weAreOnTop: boolean;
  }[];
};

export type OverlayCheckResult =
  | { ok: true; check: OverlayCheck }
  | { ok: false; error: string };

export async function checkOverlay(
  wc: WebContents,
  selector: string,
): Promise<OverlayCheckResult> {
  attach(wc);
  // JSON-encode the selector to safely embed it in the JS expression.
  const selJs = JSON.stringify(selector);
  const expression = String.raw`((sel) => {
    const round = (n) => Math.round(n);
    const safeRect = (r) => ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) });
    const el = document.querySelector(sel);
    if (!el) return { found: false };
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const myZ = parseInt(cs.zIndex, 10) || 0;
    const inViewport = b.x >= 0 && b.y >= 0 && b.x + b.width <= window.innerWidth && b.y + b.height <= window.innerHeight;
    const visible = cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0;
    const conflicts = [];
    const all = document.querySelectorAll("body *");
    for (let i = 0; i < all.length; i++) {
      const o = all[i];
      if (o === el || el.contains(o) || o.contains(el)) continue;
      const ocs = getComputedStyle(o);
      if (ocs.position !== "fixed" && ocs.position !== "sticky") continue;
      if (ocs.display === "none" || ocs.visibility === "hidden") continue;
      const ob = o.getBoundingClientRect();
      if (ob.width < 16 || ob.height < 16) continue;
      const ix = Math.max(0, Math.min(b.x + b.width, ob.x + ob.width) - Math.max(b.x, ob.x));
      const iy = Math.max(0, Math.min(b.y + b.height, ob.y + ob.height) - Math.max(b.y, ob.y));
      const overlap = ix * iy;
      if (overlap <= 0) continue;
      const oZ = parseInt(ocs.zIndex, 10) || 0;
      conflicts.push({
        tag: o.tagName.toLowerCase(),
        id: o.id || null,
        classes: (o.className || "").toString().slice(0, 60),
        bbox: safeRect(ob),
        overlapPx: Math.round(overlap),
        otherZ: oZ,
        weAreOnTop: myZ > oZ,
      });
      if (conflicts.length >= 6) break;
    }
    return { found: true, bbox: safeRect(b), inViewport, visible, zIndex: myZ, conflicts };
  })(${selJs})`;

  try {
    type EvalRes = {
      result: { type: string; value?: OverlayCheck };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    const res = await send<EvalRes>(wc, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    if (res.exceptionDetails) {
      return {
        ok: false,
        error:
          res.exceptionDetails.exception?.description ??
          res.exceptionDetails.text ??
          "Overlay check threw",
      };
    }
    if (!res.result?.value) {
      return { ok: false, error: "Overlay check returned no value" };
    }
    return { ok: true, check: res.result.value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
