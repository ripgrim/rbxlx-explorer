/* eslint-disable @typescript-eslint/no-explicit-any */
// Project model + persistence.
//
// • Project metadata + last-known rbxlx XML live in localStorage.
// • If the user picked a save folder, the FileSystemDirectoryHandle lives in
//   IndexedDB (it can't be JSON-serialized). The folder *name* is kept in the
//   metadata so we can show a label like "Saves to: maps/" without permission.
// • If FSA isn't supported or no folder was chosen, exports fall back to the
//   browser's Downloads folder.

export interface Project {
  id: string;
  name: string;
  saveFolderName: string | null;
  createdAt: number;
}

export interface SpawnPoint {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  size: [number, number, number];
}

export const DEFAULT_SPAWN_SIZE: [number, number, number] = [6, 1.2, 6];

const META_KEY = "rbxlx-explorer:project:current";
const XML_KEY = "rbxlx-explorer:project:xml";
const QUICK_XML_KEY = "rbxlx-explorer:autosave-v1";
const SPAWNS_KEY = "rbxlx-explorer:spawns";
const FORMAT_KEY = "rbxlx-explorer:source-format";

export type SourceFormat = "rbxlx" | "json";

export function loadSourceFormat(): SourceFormat {
  if (typeof window === "undefined") return "rbxlx";
  try {
    const raw = window.localStorage.getItem(FORMAT_KEY);
    return raw === "json" ? "json" : "rbxlx";
  } catch {
    return "rbxlx";
  }
}

export function saveSourceFormat(format: SourceFormat) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FORMAT_KEY, format);
  } catch (e) {
    console.warn("Failed to persist source format:", e);
  }
}

const DB_NAME = "rbxlx-explorer";
const DB_VERSION = 1;
const HANDLE_STORE = "dirHandles";

export const FSA_SUPPORTED =
  typeof window !== "undefined" && "showDirectoryPicker" in window;

// ── localStorage helpers ────────────────────────────────────────────────────

export function loadProjectMeta(): Project | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as Project) : null;
  } catch {
    return null;
  }
}

export function saveProjectMeta(project: Project | null) {
  if (typeof window === "undefined") return;
  try {
    if (project) window.localStorage.setItem(META_KEY, JSON.stringify(project));
    else window.localStorage.removeItem(META_KEY);
  } catch (e) {
    console.warn("Failed to persist project meta:", e);
  }
}

export function loadProjectXml(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(XML_KEY);
  } catch {
    return null;
  }
}

export function saveProjectXml(xml: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (xml == null) window.localStorage.removeItem(XML_KEY);
    else window.localStorage.setItem(XML_KEY, xml);
  } catch (e) {
    console.warn("Failed to persist project xml:", e);
  }
}

export function loadQuickXml(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(QUICK_XML_KEY);
  } catch {
    return null;
  }
}

export function loadSpawns(): SpawnPoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SPAWNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SpawnPoint[]) : [];
  } catch {
    return [];
  }
}

export function saveSpawns(spawns: SpawnPoint[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SPAWNS_KEY, JSON.stringify(spawns));
  } catch (e) {
    console.warn("Failed to persist spawns:", e);
  }
}

export function saveQuickXml(xml: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (xml == null) window.localStorage.removeItem(QUICK_XML_KEY);
    else window.localStorage.setItem(QUICK_XML_KEY, xml);
  } catch (e) {
    console.warn("Failed to persist quick xml:", e);
  }
}

// ── IndexedDB (directory handles) ───────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDirHandle(
  projectId: string,
  handle: FileSystemDirectoryHandle
): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDirHandle(
  projectId: string
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readonly");
      const req = tx.objectStore(HANDLE_STORE).get(projectId);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("Failed to load dir handle:", e);
    return null;
  }
}

export async function deleteDirHandle(projectId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("Failed to delete dir handle:", e);
  }
}

// ── File system writes via FSA ──────────────────────────────────────────────

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!FSA_SUPPORTED) return null;
  try {
    const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
    return handle as FileSystemDirectoryHandle;
  } catch (e: any) {
    if (e?.name === "AbortError") return null;
    console.warn("Directory pick failed:", e);
    return null;
  }
}

export async function ensureWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const h = handle as any;
  const opts = { mode: "readwrite" } as const;
  const current = await h.queryPermission?.(opts);
  if (current === "granted") return true;
  const result = await h.requestPermission?.(opts);
  return result === "granted";
}

export async function writeToDirectory(
  handle: FileSystemDirectoryHandle,
  filename: string,
  contents: string
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(contents);
  await writable.close();
}

// ── Convenience: trigger a downloads-folder save ────────────────────────────

export function downloadFile(filename: string, contents: string, mime: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function newProjectId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
