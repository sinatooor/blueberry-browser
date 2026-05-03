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
    case "writeFile":
      return { level: "safe", reason: "" };
    case "extract":
    case "wait":
    case "scroll":
    case "http":
    case "saveMemory":
    case "finish":
      return { level: "safe", reason: "" };
  }
}
