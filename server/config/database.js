import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import { getEnv } from './env.js';
import { createClient } from '@libsql/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const defaultPath = join(__dirname, '..', 'database', 'securedove.db');
let configuredPath = getEnv('DB_PATH', defaultPath);
const tursoUrl = getEnv('TURSO_DATABASE_URL', '');
const tursoAuthToken = getEnv('TURSO_AUTH_TOKEN', '');

// In Vercel serverless, refuse silent ephemeral DB unless explicitly allowed
const isVercel = !!process.env.VERCEL;
const allowEphemeral = (getEnv('ALLOW_EPHEMERAL_DB', '').toLowerCase() === 'true');

// If TURSO_DATABASE_URL is set, use the Turso (libSQL) client instead of local sqlite
const useTurso = !!tursoUrl;
if (useTurso) {
  console.log('[DB] TURSO_DATABASE_URL detected - using Turso (libSQL) client for database');
}

if (!useTurso) {
  if (isVercel) {
    if (process.env.DB_PATH && process.env.DB_PATH !== defaultPath) {
      configuredPath = process.env.DB_PATH;
    } else if (allowEphemeral) {
      configuredPath = '/tmp/securedove.db';
      console.warn('[DB] Using EPHEMERAL /tmp SQLite on Vercel (ALLOW_EPHEMERAL_DB=true). Data will not persist.');
    } else {
      console.error('[DB] Persistent database not configured. Set DB_PATH to a managed database or enable ALLOW_EPHEMERAL_DB for demo-only.');
      configuredPath = null;
    }
  }
}

function ensureDirExists(path) {
  try {
    const dir = dirname(path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    // ignore
  }
}

async function createMinimalSchema(databaseOrClient, isTursoClient = false) {
  const statements = [
    'PRAGMA foreign_keys = ON',
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      public_key TEXT NOT NULL,
      salt TEXT NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
  `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      contact_user_id INTEGER NOT NULL,
      contact_username TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (contact_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, contact_user_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)`,
    `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER NOT NULL,
      content_key_number INTEGER NOT NULL,
      username TEXT NOT NULL,
      encrypted_content_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (id, content_key_number, username),
      FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_username ON conversations(username)`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_id ON conversations(id)`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      content_key_number INTEGER NOT NULL,
      encrypted_msg_content TEXT NOT NULL,
      sender_username TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      is_deleted INTEGER DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, content_key_number)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`,
    `CREATE TABLE IF NOT EXISTS conversation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor_username TEXT,
      details TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_events_conversation ON conversation_events(conversation_id, created_at)`
  ];

  if (isTursoClient) {
    // Using libSQL client - execute statements sequentially
    for (const stmt of statements) {
      // libsql client execute may expect a simple call
      await databaseOrClient.execute({ sql: stmt });
    }
    return;
  }

  return new Promise((resolve, reject) => {
    databaseOrClient.serialize(() => {
      const runNext = (index = 0) => {
        if (index >= statements.length) {
          resolve();
          return;
        }

        databaseOrClient.run(statements[index], (err) => {
          if (err) {
            reject(err);
            return;
          }
          runNext(index + 1);
        });
      };

      runNext();
    });
  });
}

async function normalizeExistingUsernames(databaseOrClient, isTursoClient = false) {
  const cleanupStatements = [
    `UPDATE users SET username = LOWER(TRIM(username))`,
    `UPDATE contacts SET contact_username = LOWER(TRIM(contact_username))`,
    `UPDATE conversations SET username = LOWER(TRIM(username))`,
    `UPDATE messages SET sender_username = LOWER(TRIM(sender_username)) WHERE sender_username IS NOT NULL`,
    `UPDATE conversation_events SET actor_username = LOWER(TRIM(actor_username)) WHERE actor_username IS NOT NULL`,
    // Best-effort: enforce case-insensitive uniqueness (will be skipped if duplicates exist)
    `CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_nocase ON users(username COLLATE NOCASE)`
  ];

  if (isTursoClient) {
    for (const stmt of cleanupStatements) {
      try {
        await databaseOrClient.execute({ sql: stmt });
      } catch (e) {
        // best-effort: ignore failures in cleanup
      }
    }
    return;
  }

  return new Promise((resolve) => {
    databaseOrClient.serialize(() => {
      const runNext = (index = 0) => {
        if (index >= cleanupStatements.length) {
          resolve();
          return;
        }

        databaseOrClient.run(cleanupStatements[index], () => runNext(index + 1));
      };

      runNext();
    });
  });
}

async function openDatabase(path) {
  // If using Turso/libSQL, create a client and run migrations there
  if (useTurso) {
    if (!tursoUrl) throw new Error('TURSO_DATABASE_URL is not configured');
    try {
      const client = createClient({ url: tursoUrl, auth: { token: tursoAuthToken } });
      // Run schema and cleanup on Turso
      await createMinimalSchema(client, true);
      await normalizeExistingUsernames(client, true);
      console.log('[DB] Connected to Turso (libSQL) database');
      return client; // return client as db handle
    } catch (e) {
      throw e;
    }
  }

  return new Promise((resolve, reject) => {
    try {
      if (!path) {
        return reject(new Error('Database path is not configured'));
      }
      ensureDirExists(path);
      const database = new sqlite3.Database(path, async (err) => {
        if (err) return reject(err);
        console.log(`Connected to SQLite database at ${path}`);
        try {
          // Improve reliability for concurrent access
          await new Promise((res, rej) => database.exec(
            'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;',
            (e) => e ? rej(e) : res()
          ));
        } catch (e) {
          console.warn('Warning applying PRAGMAs:', e?.message || e);
        }
        await createMinimalSchema(database);
        await normalizeExistingUsernames(database);
        resolve(database);
      });
    } catch (e) {
      reject(e);
    }
  });
}

let db;
try {
  db = await openDatabase(configuredPath);
} catch (err) {
  console.error('Primary database open failed:', err?.message || err);
  if (!useTurso && isVercel && allowEphemeral) {
    try {
      // Last-resort: in-memory DB for demo only
      db = await openDatabase(':memory:');
      console.warn('Using in-memory SQLite database (serverless fallback)');
    } catch (e) {
      console.error('Fallback in-memory database open failed:', e?.message || e);
      throw e;
    }
  } else {
    throw err;
  }
}

// Helper function to run queries with promises
// If using Turso (libSQL) `db` will be a client with an execute method.
export const run = async (sql, params = []) => {
  if (useTurso) {
    try {
      const res = await db.execute({ sql, args: params });
      // libSQL doesn't expose lastID in a consistent way; return best-effort shape
      return { id: res?.lastInsertRowid ?? null, changes: res?.meta?.changes ?? (res?.rows?.length ?? 0) };
    } catch (e) {
      throw e;
    }
  }

  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve({ id: this.lastID, changes: this.changes });
      }
    });
  });
};

// Helper function to get single row
export const get = async (sql, params = []) => {
  if (useTurso) {
    const res = await db.execute({ sql, args: params });
    // convert rows/columns to object rows
    const cols = res?.columns || [];
    const rows = (res?.rows || []).map(r => {
      const obj = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i].name] = r[i];
      return obj;
    });
    return rows[0] || null;
  }

  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

// Helper function to get all rows
export const all = async (sql, params = []) => {
  if (useTurso) {
    const res = await db.execute({ sql, args: params });
    const cols = res?.columns || [];
    const rows = (res?.rows || []).map(r => {
      const obj = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i].name] = r[i];
      return obj;
    });
    return rows;
  }

  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

export default db;
