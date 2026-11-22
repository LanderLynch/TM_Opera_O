import * as fs from "fs";
import * as path from "path";

export type ShelfItemType = "image" | "text" | "document";

export interface ShelfItem {
  id: string;
  name: string;
  type: ShelfItemType;
  mimeType?: string;
  filePath?: string;
  textContent?: string;
  thumbnailPath?: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export const MAX_SHELF_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const DOC_EXTS = new Set([".pdf", ".docx", ".doc", ".txt", ".md", ".csv", ".xlsx", ".pptx", ".rtf"]);

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
};

interface SqliteLike {
  exec(sql: string): void;
  close?(): void;
  prepare(sql: string): {
    run(...params: unknown[]): void;
    all(...params: unknown[]): Array<Record<string, unknown>>;
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
}

export class ShelfStore {
  public readonly rootDir: string;
  private readonly dirs: Record<"images" | "documents" | "text" | "thumbnails", string>;
  private db: SqliteLike | null = null;
  private readonly jsonFallbackPath: string;

  constructor(baseDataDir: string) {
    this.rootDir = path.join(baseDataDir, "shelf");
    this.dirs = {
      images: path.join(this.rootDir, "images"),
      documents: path.join(this.rootDir, "documents"),
      text: path.join(this.rootDir, "text"),
      thumbnails: path.join(this.rootDir, "thumbnails"),
    };
    for (const d of Object.values(this.dirs)) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
    this.jsonFallbackPath = path.join(this.rootDir, "shelf_items.json");

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require("node:sqlite") as {
        DatabaseSync: new (file: string) => SqliteLike;
      };
      this.db = new DatabaseSync(path.join(this.rootDir, "shelf.db"));
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS shelf_items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          mime_type TEXT,
          file_path TEXT,
          text_content TEXT,
          thumbnail_path TEXT,
          size INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    } catch {
      this.db = null;
    }
  }

  private generateId(): string {
    return `sh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  private uniqueDestPath(dir: string, originalName: string): string {
    const ext = path.extname(originalName);
    const base = path.basename(originalName, ext).replace(/[<>:"/\\|?*]/g, "_") || "item";
    let candidate = path.join(dir, `${base}${ext}`);
    let counter = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${base}_${counter}${ext}`);
      counter++;
    }
    return candidate;
  }

  private saveItemMetadata(item: ShelfItem): void {
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO shelf_items (id, name, type, mime_type, file_path, text_content, thumbnail_path, size, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             text_content = excluded.text_content,
             updated_at = excluded.updated_at`
        )
        .run(
          item.id,
          item.name,
          item.type,
          item.mimeType || null,
          item.filePath || null,
          item.textContent || null,
          item.thumbnailPath || null,
          item.size,
          item.createdAt,
          item.updatedAt
        );
      return;
    }
    const items = this.listRaw().filter((x) => x.id !== item.id);
    items.unshift(item);
    fs.writeFileSync(this.jsonFallbackPath, JSON.stringify(items, null, 2), "utf-8");
  }

  private listRaw(): ShelfItem[] {
    if (this.db) {
      const rows = this.db
        .prepare("SELECT * FROM shelf_items ORDER BY updated_at DESC")
        .all();
      return rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        type: String(r.type) as ShelfItemType,
        mimeType: r.mime_type ? String(r.mime_type) : undefined,
        filePath: r.file_path ? String(r.file_path) : undefined,
        textContent: r.text_content ? String(r.text_content) : undefined,
        thumbnailPath: r.thumbnail_path ? String(r.thumbnail_path) : undefined,
        size: Number(r.size || 0),
        createdAt: Number(r.created_at || 0),
        updatedAt: Number(r.updated_at || 0),
      }));
    }
    try {
      if (fs.existsSync(this.jsonFallbackPath)) {
        return JSON.parse(fs.readFileSync(this.jsonFallbackPath, "utf-8")) as ShelfItem[];
      }
    } catch {}
    return [];
  }

  public list(): ShelfItem[] {
    // Handle missing/corrupted files safely
    return this.listRaw().filter((item) => {
      if (item.type === "text") return true;
      return Boolean(item.filePath && fs.existsSync(item.filePath));
    });
  }

  public get(id: string): ShelfItem | null {
    return this.list().find((i) => i.id === id) || null;
  }

  public search(query: string, typeFilter?: ShelfItemType | "all"): ShelfItem[] {
    const q = (query || "").toLowerCase().trim();
    return this.list().filter((item) => {
      if (typeFilter && typeFilter !== "all" && item.type !== typeFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        (item.textContent && item.textContent.toLowerCase().includes(q))
      );
    });
  }

  public importFile(sourcePath: string): { ok: boolean; item?: ShelfItem; error?: string } {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      return { ok: false, error: `File not found: ${sourcePath}` };
    }
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) {
      return { ok: false, error: "Only files can be imported to Shelf." };
    }
    if (stat.size > MAX_SHELF_FILE_BYTES) {
      const mb = (stat.size / (1024 * 1024)).toFixed(1);
      return { ok: false, error: `File "${path.basename(sourcePath)}" (${mb} MB) exceeds the 50 MB limit.` };
    }

    const ext = path.extname(sourcePath).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);
    const isDoc = DOC_EXTS.has(ext);
    if (!isImage && !isDoc) {
      return { ok: false, error: `Unsupported file type "${ext || "unknown"}".` };
    }

    const type: ShelfItemType = isImage ? "image" : "document";
    const destDir = isImage ? this.dirs.images : this.dirs.documents;
    const destPath = this.uniqueDestPath(destDir, path.basename(sourcePath));

    try {
      fs.copyFileSync(sourcePath, destPath);
      const now = Date.now();
      const item: ShelfItem = {
        id: this.generateId(),
        name: path.basename(sourcePath),
        type,
        mimeType: MIME_MAP[ext] || "application/octet-stream",
        filePath: destPath,
        thumbnailPath: isImage ? destPath : undefined,
        size: stat.size,
        createdAt: now,
        updatedAt: now,
      };
      this.saveItemMetadata(item);
      return { ok: true, item };
    } catch (e) {
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch {}
      return { ok: false, error: `Import failed: ${String(e)}` };
    }
  }

  public addText(text: string, customName?: string): { ok: boolean; item?: ShelfItem; error?: string } {
    const trimmed = (text || "").trim();
    if (!trimmed) return { ok: false, error: "Text content is empty." };
    const buf = Buffer.from(trimmed, "utf-8");
    if (buf.length > MAX_SHELF_FILE_BYTES) {
      return { ok: false, error: "Text content exceeds 50 MB limit." };
    }
    const now = Date.now();
    const name = customName?.trim() || trimmed.split(/\r?\n/)[0].slice(0, 32) || "Note";
    const filePath = this.uniqueDestPath(this.dirs.text, `${name}.txt`);
    fs.writeFileSync(filePath, trimmed, "utf-8");

    const item: ShelfItem = {
      id: this.generateId(),
      name,
      type: "text",
      mimeType: "text/plain",
      filePath,
      textContent: trimmed,
      size: buf.length,
      createdAt: now,
      updatedAt: now,
    };
    this.saveItemMetadata(item);
    return { ok: true, item };
  }

  public addImageBuffer(
    buf: Buffer,
    ext = ".png",
    name = `Clipboard_${Date.now()}.png`
  ): { ok: boolean; item?: ShelfItem; error?: string } {
    if (!buf || buf.length === 0) return { ok: false, error: "Image buffer is empty." };
    if (buf.length > MAX_SHELF_FILE_BYTES) {
      return { ok: false, error: "Clipboard image exceeds 50 MB limit." };
    }
    const safeExt = IMAGE_EXTS.has(ext.toLowerCase()) ? ext.toLowerCase() : ".png";
    const destPath = this.uniqueDestPath(this.dirs.images, name.endsWith(safeExt) ? name : `${name}${safeExt}`);
    fs.writeFileSync(destPath, buf);

    const now = Date.now();
    const item: ShelfItem = {
      id: this.generateId(),
      name: path.basename(destPath),
      type: "image",
      mimeType: MIME_MAP[safeExt] || "image/png",
      filePath: destPath,
      thumbnailPath: destPath,
      size: buf.length,
      createdAt: now,
      updatedAt: now,
    };
    this.saveItemMetadata(item);
    return { ok: true, item };
  }

  public delete(id: string): boolean {
    const existing = this.listRaw().find((i) => i.id === id);
    if (!existing) return false;

    // Delete only Shelf's own internal copy (never touch user's original source file)
    if (existing.filePath && existing.filePath.startsWith(this.rootDir) && fs.existsSync(existing.filePath)) {
      try {
        fs.unlinkSync(existing.filePath);
      } catch {}
    }

    if (this.db) {
      this.db.prepare("DELETE FROM shelf_items WHERE id = ?").run(id);
    } else {
      const remaining = this.listRaw().filter((i) => i.id !== id);
      fs.writeFileSync(this.jsonFallbackPath, JSON.stringify(remaining, null, 2), "utf-8");
    }
    return true;
  }

  public getStorageInfo(): { itemCount: number; totalBytes: number; rootDir: string } {
    const items = this.list();
    const totalBytes = items.reduce((acc, i) => acc + i.size, 0);
    return {
      itemCount: items.length,
      totalBytes,
      rootDir: this.rootDir,
    };
  }

  public close(): void {
    try {
      this.db?.close?.();
    } catch {}
    this.db = null;
  }
}
