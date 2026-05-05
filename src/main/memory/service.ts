import { parse as parseTld } from "tldts";
import { getSiteMemory, setSiteMemory, deleteSiteMemory } from "../projects/store";
import type { MemoryUpdate, SiteAugmentation, SiteMemory } from "../../common/types";

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
    augmentations: [],
    updatedAt: Date.now(),
  };
}

export function getMemory(domain: string): SiteMemory {
  const mem = getSiteMemory(domain) ?? emptyMemory(domain);
  // Backfill for memories persisted before the augmentations field existed.
  if (!Array.isArray(mem.augmentations)) mem.augmentations = [];
  return mem;
}

export function getAugmentations(domain: string): SiteAugmentation[] {
  return getMemory(domain).augmentations.filter((a) => a.enabled);
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
      case "augmentation": {
        if (!u.id.startsWith("bb-")) {
          // Reject anything that isn't bb-* prefixed — replay must be
          // attributable to us, and the agent's idempotent guards rely on it.
          break;
        }
        const existing = mem.augmentations.find((a) => a.id === u.id);
        if (existing) {
          existing.name = u.name;
          existing.script = u.script;
          existing.enabled = true;
          existing.addedAt = Date.now();
        } else {
          mem.augmentations.push({
            id: u.id,
            name: u.name,
            script: u.script,
            addedAt: Date.now(),
            enabled: true,
          });
        }
        break;
      }
      case "removeAugmentation": {
        mem.augmentations = mem.augmentations.filter((a) => a.id !== u.id);
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

// User-driven toggles for saved extensions (Site Augmentations). Distinct
// from `applyUpdates` because the existing kinds always set enabled=true on
// upsert; the Extensions popover lets the user pause one without losing it.
export function setAugmentationEnabled(
  domain: string,
  id: string,
  enabled: boolean,
): SiteMemory {
  const mem = getMemory(domain);
  const aug = mem.augmentations.find((a) => a.id === id);
  if (aug) {
    aug.enabled = enabled;
    mem.updatedAt = Date.now();
    setSiteMemory(mem);
  }
  return mem;
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
