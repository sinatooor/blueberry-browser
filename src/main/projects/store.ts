import { app } from "electron";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { nanoid } from "nanoid";
import type {
  Project,
  SandboxFile,
  AgentRun,
  AgentStep,
  NetRequest,
  SiteMemory,
} from "../../common/types";

let db: Database.Database | null = null;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "project"
  );
}

export function initProjectStore(): Database.Database {
  if (db) return db;

  const userData = app.getPath("userData");
  const dbPath = path.join(userData, "blueberry.db");
  fs.mkdirSync(userData, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      archived_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      path TEXT NOT NULL,
      source TEXT NOT NULL,
      url TEXT,
      title TEXT,
      mime TEXT,
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      summary TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      idx INTEGER NOT NULL,
      step_json TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS site_memory (
      domain TEXT PRIMARY KEY,
      blob_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS net_requests (
      id TEXT PRIMARY KEY,
      tab_id TEXT NOT NULL,
      project_id TEXT,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER,
      resource_type TEXT,
      req_headers TEXT,
      req_body TEXT,
      res_headers TEXT,
      res_body TEXT,
      res_body_truncated INTEGER,
      ts INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_project ON files(project_id);
    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
    CREATE INDEX IF NOT EXISTS idx_steps_run ON steps(run_id);
    CREATE INDEX IF NOT EXISTS idx_net_tab ON net_requests(tab_id);
  `);

  // Seed Inbox project on first launch
  const existing = db
    .prepare("SELECT 1 FROM projects WHERE slug = 'inbox'")
    .get();
  if (!existing) {
    db.prepare(
      "INSERT INTO projects (id, slug, name, created_at) VALUES (?, ?, ?, ?)",
    ).run(nanoid(10), "inbox", "Inbox", Date.now());
  }

  // Seed a demo project for the headline flow
  const demo = db
    .prepare("SELECT 1 FROM projects WHERE slug = 'saas-investigation'")
    .get();
  if (!demo) {
    db.prepare(
      "INSERT INTO projects (id, slug, name, created_at) VALUES (?, ?, ?, ?)",
    ).run(nanoid(10), "saas-investigation", "SaaS Investigation", Date.now());
  }

  return db;
}

function getDb(): Database.Database {
  if (!db) initProjectStore();
  return db!;
}

// ---- Projects --------------------------------------------------------------

export function listProjects(): Project[] {
  return getDb()
    .prepare(
      "SELECT id, slug, name, created_at as createdAt, archived_at as archivedAt FROM projects ORDER BY created_at DESC",
    )
    .all() as Project[];
}

export function createProject(name: string): Project {
  const id = nanoid(10);
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let i = 1;
  while (
    getDb().prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug)
  ) {
    slug = `${baseSlug}-${i++}`;
  }
  const createdAt = Date.now();
  getDb()
    .prepare(
      "INSERT INTO projects (id, slug, name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, slug, name, createdAt);
  return { id, slug, name, createdAt };
}

export function getProject(idOrSlug: string): Project | null {
  return (
    (getDb()
      .prepare(
        "SELECT id, slug, name, created_at as createdAt, archived_at as archivedAt FROM projects WHERE id = ? OR slug = ?",
      )
      .get(idOrSlug, idOrSlug) as Project | undefined) ?? null
  );
}

export function archiveProject(id: string): void {
  getDb()
    .prepare("UPDATE projects SET archived_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

// ---- Files -----------------------------------------------------------------

export function addFile(file: Omit<SandboxFile, "id" | "createdAt">): SandboxFile {
  const id = nanoid(10);
  const createdAt = Date.now();
  getDb()
    .prepare(
      `INSERT INTO files (id, project_id, path, source, url, title, mime, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      file.projectId,
      file.path,
      file.source,
      file.url ?? null,
      file.title ?? null,
      file.mime ?? null,
      file.bytes,
      createdAt,
    );
  return { ...file, id, createdAt };
}

export function listFiles(projectId: string): SandboxFile[] {
  return getDb()
    .prepare(
      `SELECT id, project_id as projectId, path, source, url, title, mime, bytes, created_at as createdAt
       FROM files WHERE project_id = ? ORDER BY created_at DESC`,
    )
    .all(projectId) as SandboxFile[];
}

export function moveFileToProject(
  fileId: string,
  destProjectId: string,
  newPath: string,
): void {
  getDb()
    .prepare("UPDATE files SET project_id = ?, path = ? WHERE id = ?")
    .run(destProjectId, newPath, fileId);
}

// ---- Runs + steps ---------------------------------------------------------

export function createRun(run: AgentRun): void {
  getDb()
    .prepare(
      `INSERT INTO runs (id, project_id, prompt, status, started_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(run.id, run.projectId, run.prompt, run.status, run.startedAt);
}

export function updateRun(
  id: string,
  patch: Partial<Pick<AgentRun, "status" | "endedAt" | "summary">>,
): void {
  const updates: string[] = [];
  const values: unknown[] = [];
  if (patch.status) {
    updates.push("status = ?");
    values.push(patch.status);
  }
  if (patch.endedAt !== undefined) {
    updates.push("ended_at = ?");
    values.push(patch.endedAt);
  }
  if (patch.summary !== undefined) {
    updates.push("summary = ?");
    values.push(patch.summary);
  }
  if (!updates.length) return;
  values.push(id);
  getDb()
    .prepare(`UPDATE runs SET ${updates.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function persistStep(step: AgentStep): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO steps (id, run_id, idx, step_json) VALUES (?, ?, ?, ?)`,
    )
    .run(step.id, step.runId, step.index, JSON.stringify(step));
}

export function listRuns(projectId: string): AgentRun[] {
  return getDb()
    .prepare(
      `SELECT id, project_id as projectId, prompt, status, started_at as startedAt, ended_at as endedAt, summary
       FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT 50`,
    )
    .all(projectId) as AgentRun[];
}

export function getRunSteps(runId: string): AgentStep[] {
  const rows = getDb()
    .prepare("SELECT step_json FROM steps WHERE run_id = ? ORDER BY idx ASC")
    .all(runId) as { step_json: string }[];
  return rows.map((r) => JSON.parse(r.step_json) as AgentStep);
}

// ---- Site memory ----------------------------------------------------------

export function getSiteMemory(domain: string): SiteMemory | null {
  const row = getDb()
    .prepare("SELECT blob_json FROM site_memory WHERE domain = ?")
    .get(domain) as { blob_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.blob_json) as SiteMemory;
  } catch {
    return null;
  }
}

export function setSiteMemory(memory: SiteMemory): void {
  getDb()
    .prepare(
      `INSERT INTO site_memory (domain, blob_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET blob_json = excluded.blob_json, updated_at = excluded.updated_at`,
    )
    .run(memory.domain, JSON.stringify(memory), Date.now());
}

export function deleteSiteMemory(domain: string): void {
  getDb().prepare("DELETE FROM site_memory WHERE domain = ?").run(domain);
}

// ---- Network requests -----------------------------------------------------

export function persistNetRequest(req: NetRequest): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO net_requests
        (id, tab_id, project_id, method, url, status, resource_type, req_headers, req_body, res_headers, res_body, res_body_truncated, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      req.id,
      req.tabId,
      req.projectId ?? null,
      req.method,
      req.url,
      req.status ?? null,
      req.resourceType ?? null,
      req.reqHeaders ? JSON.stringify(req.reqHeaders) : null,
      req.reqBody ?? null,
      req.resHeaders ? JSON.stringify(req.resHeaders) : null,
      req.resBody ?? null,
      req.resBodyTruncated ? 1 : 0,
      req.ts,
    );
}
