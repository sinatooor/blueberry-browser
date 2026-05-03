import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import { getProject } from "./store";

export function projectsRoot(): string {
  return path.join(app.getPath("userData"), "projects");
}

export function projectDir(projectId: string): string {
  const p = getProject(projectId);
  if (!p) throw new Error(`Project not found: ${projectId}`);
  const dir = path.join(projectsRoot(), p.slug);
  fs.mkdirSync(path.join(dir, "files"), { recursive: true });
  fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  return dir;
}

export function projectFilesDir(projectId: string): string {
  return path.join(projectDir(projectId), "files");
}

export function projectScreenshotsDir(projectId: string): string {
  return path.join(projectDir(projectId), "screenshots");
}

export function projectOutputsDir(projectId: string): string {
  return path.join(projectDir(projectId), "outputs");
}

/**
 * Throws if `target` would resolve outside `projectId`'s sandbox.
 * Returns the absolute, resolved path.
 */
export function resolveInProject(projectId: string, relative: string): string {
  const root = projectDir(projectId);
  const abs = path.resolve(root, relative);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: ${relative}`);
  }
  return abs;
}

export function writeProjectFile(
  projectId: string,
  relative: string,
  data: string | Buffer,
): string {
  const abs = resolveInProject(projectId, relative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  return abs;
}

export function readProjectFile(projectId: string, relative: string): Buffer {
  const abs = resolveInProject(projectId, relative);
  return fs.readFileSync(abs);
}

export function projectFileSize(projectId: string, relative: string): number {
  try {
    const abs = resolveInProject(projectId, relative);
    return fs.statSync(abs).size;
  } catch {
    return 0;
  }
}
