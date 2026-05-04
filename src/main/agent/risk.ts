import type { AgentAction, RiskLevel } from "../../common/types";

const DESTRUCTIVE_SELECTORS = [
  /\[type\s*=\s*["']?submit["']?/i,
  /button.*\b(submit|delete|remove|purchase|pay|send|confirm)\b/i,
  /\bform\[action\*=["']?(payment|checkout|delete|remove|charge)/i,
  /\b(deletebtn|removebtn|paybtn|sendbtn|submitbtn)\b/i,
];

const CAUTION_SELECTORS = [
  /input\[type=["']?password["']?/i,
  /input\[name\*=["']?(password|passwd|pwd|secret)/i,
  /\[href\^=["']?mailto:/i,
  /\[href\^=["']?tel:/i,
];

const DESTRUCTIVE_TEXT = /\b(delete|remove|purchase|pay\b|send|submit|confirm|charge)\b/i;

export function classifyAction(
  action: AgentAction,
  ctx?: { currentDomain?: string },
): { level: RiskLevel; reason: string } {
  switch (action.type) {
    case "click": {
      if (DESTRUCTIVE_SELECTORS.some((p) => p.test(action.selector))) {
        return { level: "destructive", reason: "Selector matches a known destructive pattern" };
      }
      if (CAUTION_SELECTORS.some((p) => p.test(action.selector))) {
        return { level: "caution", reason: "Sensitive selector (auth/contact)" };
      }
      return { level: "safe", reason: "" };
    }
    case "type": {
      if (CAUTION_SELECTORS.some((p) => p.test(action.selector))) {
        return { level: "caution", reason: "Typing into a password/contact field" };
      }
      return { level: "safe", reason: "" };
    }
    case "navigate": {
      try {
        const u = new URL(action.url);
        if (ctx?.currentDomain && !u.hostname.endsWith(ctx.currentDomain)) {
          return { level: "caution", reason: `Off-domain navigation to ${u.hostname}` };
        }
      } catch {
        return { level: "caution", reason: "Unparseable URL" };
      }
      return { level: "safe", reason: "" };
    }
    case "runCode": {
      if (DESTRUCTIVE_TEXT.test(action.source) && /\b(rm|unlink|os\.remove|shutil)\b/.test(action.source)) {
        return { level: "destructive", reason: "Code references file deletion" };
      }
      return { level: "safe", reason: "" };
    }
    case "evalJs": {
      const src = action.source;
      // Anything that exfiltrates / sends data off-page or wipes auth state
      // demands an explicit user OK.
      if (
        /\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new\s+WebSocket\b/.test(src) ||
        /document\.cookie\s*=|localStorage\.clear\s*\(|sessionStorage\.clear\s*\(/.test(src) ||
        /\b(window\.location|location\.href|location\.assign|location\.replace)\s*=/.test(src)
      ) {
        return {
          level: "destructive",
          reason: "Script makes a network call, navigates away, or wipes auth state",
        };
      }
      // DOM-only mutations (the day/night-button case) are safe.
      return { level: "safe", reason: "" };
    }
    case "writeFile":
      return { level: "safe", reason: "" };
    case "extract":
    case "wait":
    case "scroll":
    case "http":
    case "inspectPage":
    case "verifyOverlay":
    case "verifyVisually":
    case "saveMemory":
    case "removeAugmentation":
    case "finish":
      return { level: "safe", reason: "" };
    case "saveAugmentation": {
      // Persisting a script that auto-runs on every visit deserves a heads-up
      // toast (caution) — but not a blocking modal, since the user just
      // watched the script land in Mission Control.
      return {
        level: "caution",
        reason: "This script will auto-run on every page load on this domain.",
      };
    }
  }
}
