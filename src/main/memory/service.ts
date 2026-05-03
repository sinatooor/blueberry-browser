import { parse as parseTld } from "tldts";
import { getSiteMemory, setSiteMemory, deleteSiteMemory } from "../projects/store";
import type { MemoryUpdate, SiteMemory } from "../../common/types";

export function domainFor(url: string): string | null {
  try {
    const parsed = parseTld(url);
    return parsed.domain ?? parsed.hostname ?? null;
  } catch {
    return null;
  }
}

function emptyMemory(domain: string): SiteMemory {
  return {
    domain,
    procedures: [],
    selectors: [],
    glossary: [],
    preferences: {},
    updatedAt: Date.now(),
  };
}

export function getMemory(domain: string): SiteMemory {
  return getSiteMemory(domain) ?? emptyMemory(domain);
}

export function applyUpdates(domain: string, updates: MemoryUpdate[]): SiteMemory {
  const mem = getMemory(domain);
  for (const u of updates) {
    switch (u.kind) {
      case "procedure": {
        const existing = mem.procedures.find((p) => p.name === u.name);
        if (existing) {
          existing.steps = u.steps;
          existing.lastVerified = Date.now();
        } else {
          mem.procedures.push({ name: u.name, steps: u.steps, lastVerified: Date.now() });
        }
        break;
      }
      case "selector": {
        const existing = mem.selectors.find((s) => s.intent === u.intent);
        if (existing) {
          existing.selector = u.selector;
          existing.lastSeenAt = Date.now();
          existing.stale = false;
        } else {
          mem.selectors.push({
            intent: u.intent,
            selector: u.selector,
            lastSeenAt: Date.now(),
          });
        }
        break;
      }
      case "glossary": {
        const existing = mem.glossary.find((g) => g.term === u.term);
        if (existing) existing.definition = u.definition;
        else mem.glossary.push({ term: u.term, definition: u.definition });
        break;
      }
      case "preference": {
        mem.preferences[u.key] = u.value;
        break;
      }
    }
  }
  mem.updatedAt = Date.now();
  setSiteMemory(mem);
  return mem;
}

export function clearMemory(domain: string): void {
  deleteSiteMemory(domain);
}

// Proposed memory updates — surface to user as a toast for accept/edit/reject
const proposed = new Map<string, MemoryUpdate[]>();

export function addProposedMemory(domain: string, updates: MemoryUpdate[]): void {
  const existing = proposed.get(domain) ?? [];
  proposed.set(domain, [...existing, ...updates]);
}

export function listProposed(domain: string): MemoryUpdate[] {
  return proposed.get(domain) ?? [];
}

export function acceptProposed(domain: string, accepted: MemoryUpdate[]): SiteMemory {
  const mem = applyUpdates(domain, accepted);
  proposed.delete(domain);
  return mem;
}
