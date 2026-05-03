import { Session, app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { addFile, listProjects } from "../projects/store";
import { projectFilesDir } from "../projects/sandbox";
import { Channels } from "../../common/channels";

type Rule = {
  match: { domain?: string; filenameRegex?: string; mime?: string };
  projectSlug: string;
};

const DEFAULT_RULES: Rule[] = [
  // No defaults — user-configurable. Slot for project-specific overrides.
];

function loadRules(): Rule[] {
  try {
    const p = path.join(app.getPath("userData"), "download-rules.json");
    if (!fs.existsSync(p)) return DEFAULT_RULES;
    return JSON.parse(fs.readFileSync(p, "utf8")) as Rule[];
  } catch {
    return DEFAULT_RULES;
  }
}

function matchRule(
  url: string,
  filename: string,
  mime: string,
  rules: Rule[],
): string | null {
  for (const r of rules) {
    const okDomain =
      !r.match.domain ||
      new URL(url).hostname.endsWith(r.match.domain.replace(/^\*\./, ""));
    const okMime = !r.match.mime || mime.includes(r.match.mime);
    const okName = !r.match.filenameRegex || new RegExp(r.match.filenameRegex).test(filename);
    if (okDomain && okMime && okName) return r.projectSlug;
  }
  return null;
}

let activeProjectIdProvider: (() => string | null) | null = null;
let emitter: ((channel: string, payload: unknown) => void) | null = null;

export function bindDownloadRouter(opts: {
  getActiveProjectId: () => string | null;
  emit: (channel: string, payload: unknown) => void;
}): void {
  activeProjectIdProvider = opts.getActiveProjectId;
  emitter = opts.emit;
}

export function attachDownloadRouter(session: Session): void {
  session.on("will-download", (_event, item, _wc) => {
    const url = item.getURL();
    const filename = item.getFilename();
    const mime = item.getMimeType();

    // Decide where this goes.
    const rules = loadRules();
    const ruleMatch = matchRule(url, filename, mime, rules);

    let projectSlug: string | null = ruleMatch;
    if (!projectSlug) {
      // Fallback: route to active project, else inbox.
      const activeId = activeProjectIdProvider?.() ?? null;
      const projects = listProjects();
      const active = activeId ? projects.find((p) => p.id === activeId) : null;
      projectSlug = active?.slug ?? "inbox";
    }
    const projects = listProjects();
    const proj = projects.find((p) => p.slug === projectSlug) ?? projects.find((p) => p.slug === "inbox");
    if (!proj) return;

    const filesDir = projectFilesDir(proj.id);
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const destination = path.join(filesDir, safeName);
    item.setSavePath(destination);

    item.once("done", (_e, state) => {
      if (state !== "completed") return;
      const stat = fs.statSync(destination);
      const file = addFile({
        projectId: proj.id,
        path: safeName,
        source: "download",
        url,
        title: filename,
        mime,
        bytes: stat.size,
      });
      emitter?.(Channels.EventFileAdded, { projectId: proj.id, path: safeName });
      emitter?.(Channels.EventToast, {
        kind: "info",
        title: "Download routed",
        body: `${filename} → ${proj.name}`,
      });
      console.log(`[downloads] ${filename} → ${proj.slug} (${stat.size}B)`);
      void file;
    });
  });
}
