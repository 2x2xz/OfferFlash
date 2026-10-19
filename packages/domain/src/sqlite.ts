import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

const require = createRequire(import.meta.url);
const owners = new Set<string>();
let sqlite: Promise<SqlJsStatic> | undefined;

function loadSqlite(): Promise<SqlJsStatic> {
  sqlite ??= initSqlJs({ locateFile: () => require.resolve("sql.js/dist/sql-wasm.wasm") });
  return sqlite;
}

/** A real SQLite table; JSON payloads retain versioned domain records without loose JSON files. */
const schema = `
  CREATE TABLE IF NOT EXISTS documents (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (kind, id)
  );
  CREATE INDEX IF NOT EXISTS documents_by_kind ON documents(kind, updated_at);
  PRAGMA user_version = 1;
`;

async function syncDirectory(directory: string): Promise<void> {
  // Windows does not expose POSIX directory handles; the database file itself is always synced.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceDatabase(path: string, directory: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    renamed = true;
    await syncDirectory(directory);
  } catch (error) {
    if (renamed) {
      // The caller must retain the new in-memory state if rename already committed it on disk.
      throw new DatabaseCommitError("SQLite 已替换，但目录同步失败，持久性需要核实", error);
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

class DatabaseCommitError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "DatabaseCommitError";
  }
}

export interface DatabaseFile {
  readonly path: string;
  read<T>(operation: (db: Database) => T): Promise<T>;
  transact<T>(operation: (db: Database) => T): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabaseFile(options: { directory: string }): Promise<DatabaseFile> {
  await mkdir(resolve(options.directory), { recursive: true, mode: 0o700 });
  const directory = await realpath(resolve(options.directory));
  const path = join(directory, "offeragent.sqlite");
  if (owners.has(path)) throw new Error("此 SQLite 文件已经由另一个 store 打开");
  owners.add(path);
  let db: Database | undefined;
  try {
    const SQL = await loadSqlite();
    let bytes: Uint8Array | undefined;
    try {
      bytes = new Uint8Array(await readFile(path));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    if (bytes && Buffer.from(bytes.subarray(0, 16)).toString("utf8") !== "SQLite format 3\0") {
      throw new Error("SQLite 文件头有误；原文件已保留，不会自动重置");
    }
    db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    const version = db.exec("PRAGMA user_version")[0]?.values[0]?.[0];
    if (version !== 0 && version !== 1) throw new Error(`不支持的 SQLite schema 版本：${String(version)}`);
    db.run(schema);
    if (!bytes || version === 0) await replaceDatabase(path, directory, db.export());

    let current = db;
    let queue = Promise.resolve();
    let closing = false;
    let closed = false;
    let closePromise: Promise<void> | undefined;

    const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
      if (closing || closed) return Promise.reject(new Error("Store 已关闭"));
      const result = queue.then(operation);
      queue = result.then(() => undefined, () => undefined);
      return result;
    };

    return {
      path,
      read<T>(operation: (database: Database) => T): Promise<T> {
        return enqueue(async () => operation(current));
      },
      transact<T>(operation: (database: Database) => T): Promise<T> {
        return enqueue(async () => {
          const candidate = new SQL.Database(current.export());
          let adopted = false;
          try {
            candidate.run("BEGIN IMMEDIATE");
            const result = operation(candidate);
            candidate.run("COMMIT");
            try {
              await replaceDatabase(path, directory, candidate.export());
            } catch (error) {
              if (error instanceof DatabaseCommitError) {
                current.close();
                current = candidate;
                adopted = true;
              }
              throw error;
            }
            current.close();
            current = candidate;
            adopted = true;
            return result;
          } finally {
            if (!adopted) candidate.close();
          }
        });
      },
      close(): Promise<void> {
        if (!closePromise) {
          closing = true;
          closePromise = queue.then(() => {
            current.close();
            closed = true;
            owners.delete(path);
          });
        }
        return closePromise;
      },
    };
  } catch (error) {
    db?.close();
    owners.delete(path);
    throw error;
  }
}

export function readDocument<T>(db: Database, kind: string, id: string): T | undefined {
  const statement = db.prepare("SELECT payload FROM documents WHERE kind = ? AND id = ?");
  try {
    statement.bind([kind, id]);
    if (!statement.step()) return undefined;
    const payload = statement.getAsObject().payload;
    if (typeof payload !== "string") throw new Error("SQLite 记录格式有误");
    return JSON.parse(payload) as T;
  } finally {
    statement.free();
  }
}

export function readDocuments<T>(db: Database, kind: string): T[] {
  const statement = db.prepare("SELECT payload FROM documents WHERE kind = ? ORDER BY updated_at DESC, id");
  try {
    statement.bind([kind]);
    const records: T[] = [];
    while (statement.step()) {
      const payload = statement.getAsObject().payload;
      if (typeof payload !== "string") throw new Error("SQLite 记录格式有误");
      records.push(JSON.parse(payload) as T);
    }
    return records;
  } finally {
    statement.free();
  }
}

export function writeDocument(db: Database, kind: string, id: string, value: unknown, now: string): void {
  db.run(
    "INSERT INTO documents(kind, id, payload, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(kind, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
    [kind, id, JSON.stringify(value), now],
  );
}

export function deleteDocument(db: Database, kind: string, id: string): void {
  db.run("DELETE FROM documents WHERE kind = ? AND id = ?", [kind, id]);
}
