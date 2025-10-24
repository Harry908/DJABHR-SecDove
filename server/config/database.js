import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import fs from 'fs';
import { getEnv } from './env.js';
import { createClient } from '@libsql/client';

// Prefer a database path relative to the current working directory so we
// don't rely on import.meta.url which may not exist when code is compiled
// to CommonJS in some environments.
const defaultPath = join(process.cwd(), 'database', 'securedove.db');
let configuredPath = getEnv('DB_PATH', defaultPath);
const tursoUrl = getEnv('TURSO_DATABASE_URL', '');
const tursoAuthToken = getEnv('TURSO_AUTH_TOKEN', '');

// In Vercel serverless, refuse silent ephemeral DB unless explicitly allowed
const isVercel = !!process.env.VERCEL;
const allowEphemeral = (getEnv('ALLOW_EPHEMERAL_DB', '').toLowerCase() === 'true');

// If TURSO_DATABASE_URL is set and not empty, use the Turso (libSQL) client instead of local sqlite
const useTurso = !!(tursoUrl && tursoUrl.trim());
if (useTurso) {
  console.log('[DB] TURSO_DATABASE_URL detected - using Turso (libSQL) client for database');
  console.log('[DB] TURSO_AUTH_TOKEN is', tursoAuthToken ? `present (length: ${tursoAuthToken.length})` : 'MISSING');
} else {
  console.log('[DB] Using local SQLite database');
}

if (!useTurso) {
  if (isVercel) {
    if (process.env.DB_PATH && process.env.DB_PATH !== defaultPath) {
      configuredPath = process.env.DB_PATH;
    } else if (allowEphemeral) {
      configuredPath = '/tmp/securedove.db';
      console.warn('[DB] Using EPHEMERAL /tmp SQLite on Vercel (ALLOW_EPHEMERAL_DB=true). Data will not persist.');
    } else {
      console.error('[DB] Persistent database not configured for Vercel. Set TURSO_DATABASE_URL for Turso or ALLOW_EPHEMERAL_DB=true for demo-only ephemeral DB.');
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
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
      username TEXT NOT NULL COLLATE NOCASE,
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
      sender_username TEXT COLLATE NOCASE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      is_deleted INTEGER DEFAULT 0,
      FOREIGN KEY (sender_username) REFERENCES users(username) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, content_key_number)`,
    `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`,
    `CREATE TABLE IF NOT EXISTS conversation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      actor_username TEXT COLLATE NOCASE,
      details TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (actor_username) REFERENCES users(username) ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_events_conversation ON conversation_events(conversation_id, created_at)`
  ];

  if (isTursoClient) {
    // Filter out PRAGMA statements and prepare statements for batch execution
    const validStatements = statements.filter(stmt =>
      stmt && typeof stmt === 'string' && !stmt.trim().toUpperCase().startsWith('PRAGMA')
    );

    console.log(`[DB] Creating schema with ${validStatements.length} statements via batch`);

    try {
      // Use batch execution for Turso
      await databaseOrClient.batch(validStatements.map(sql => ({ sql, args: [] })));
      console.log('[DB] Schema creation successful');
    } catch (e) {
      console.error('[DB] Batch schema creation failed:', e);
      throw e;
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
    `UPDATE conversation_events SET actor_username = LOWER(TRIM(actor_username)) WHERE actor_username IS NOT NULL`
  ];

  if (isTursoClient) {
    // Execute cleanup statements via batch for Turso - log but don't fail
    try {
      await databaseOrClient.batch(cleanupStatements.map(sql => ({ sql, args: [] })), "write");
      console.log('[DB] Username normalization completed');
    } catch (e) {
      // Log the error but don't fail - cleanup is best-effort
      console.warn(`[DB] Username normalization failed (non-critical): ${e.message}`);
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

        databaseOrClient.run(cleanupStatements[index], (err) => {
          if (err) {
            console.warn(`[DB] Cleanup statement failed (non-critical): ${cleanupStatements[index].substring(0, 50)}...`);
          }
          runNext(index + 1);
        });
      };

      runNext();
    });
  });
}

async function openDatabase(path) {
  // If using Turso/libSQL, create a client and run migrations there
  if (useTurso) {
    if (!tursoUrl) throw new Error('TURSO_DATABASE_URL is not configured');
    if (!tursoAuthToken || tursoAuthToken.trim() === '') {
      throw new Error('TURSO_AUTH_TOKEN is not configured. Please set it in your Vercel environment variables.');
    }
    try {
      console.log('[DB] Connecting to Turso with auth token (length:', tursoAuthToken.length, ')');
      const client = createClient({ 
        url: tursoUrl, 
        authToken: tursoAuthToken 
      });
      // Run schema and cleanup on Turso
      await createMinimalSchema(client, true);
      await normalizeExistingUsernames(client, true);
      console.log('[DB] Connected to Turso (libSQL) database');
      return client; // return client as db handle
    } catch (e) {
      console.error('[DB] Turso connection failed:', e.message);
      throw e;
    }
  }

  // Local SQLite database
  return new Promise((resolve, reject) => {
    try {
      if (!path) {
        return reject(new Error('Database path is not configured'));
      }
      ensureDirExists(path);
      const database = new sqlite3.Database(path, async (err) => {
        if (err) {
          console.error('[DB] SQLite connection failed:', err.message);
          return reject(err);
        }

        console.log(`[DB] Connected to SQLite database at ${path}`);

        try {
          // Improve reliability for concurrent access
          await new Promise((res, rej) => database.exec(
            'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;',
            (e) => e ? rej(e) : res()
          ));
          console.log('[DB] SQLite PRAGMAs applied');
        } catch (e) {
          console.warn('[DB] Warning applying PRAGMAs:', e?.message || e);
        }

        try {
          await createMinimalSchema(database);
          await normalizeExistingUsernames(database);
          console.log('[DB] SQLite schema initialized');
          resolve(database);
        } catch (schemaError) {
          console.error('[DB] Schema initialization failed:', schemaError.message);
          reject(schemaError);
        }
      });
    } catch (e) {
      console.error('[DB] Database setup failed:', e.message);
      reject(e);
    }
  });
}

// Initialize database asynchronously and expose a promise so callers can
// await initialization without relying on top-level await (which breaks in
// some CommonJS-compiled environments).
let db;
let dbInitialized = false;
let dbInitializing = false;

const initializeDatabase = async () => {
  if (dbInitialized) return db;
  if (dbInitializing) {
    // Wait for ongoing initialization
    while (dbInitializing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return db;
  }

  dbInitializing = true;

  try {
    db = await openDatabase(configuredPath);
    dbInitialized = true;
    console.log('[DB] Database initialized successfully');
    return db;
  } catch (err) {
    console.error('Database initialization failed:', err?.message || err);
    dbInitializing = false;
    throw err;
  }
};

// Simplified promise-based getter
const getDbPromise = () => initializeDatabase();

// Helper function to convert BigInt values to Number for JSON compatibility
const convertBigIntToNumber = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (Array.isArray(obj)) return obj.map(convertBigIntToNumber);
  if (typeof obj === 'object') {
    const converted = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = typeof value === 'bigint' ? Number(value) : value;
    }
    return converted;
  }
  return obj;
};

// Helper function to run queries with promises
// If using Turso (libSQL) `db` will be a client with an execute method.
export const run = async (sql, params = []) => {
  if (!sql || typeof sql !== 'string') {
    throw new Error('SQL query must be a non-empty string');
  }

  // Ensure DB is initialized
  await getDbPromise();

  try {
    if (useTurso) {
      const res = await db.execute({ sql, args: params });
      // libSQL returns BigInt for lastInsertRowid, convert to Number for JSON compatibility
      const lastId = res?.lastInsertRowid;
      return { 
        id: lastId !== null && lastId !== undefined ? Number(lastId) : null, 
        changes: res?.meta?.changes ?? (res?.rows?.length ?? 0) 
      };
    }

    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) {
          console.error('[DB] Run query failed:', sql.substring(0, 50), '...');
          reject(err);
        } else {
          resolve({ id: this.lastID, changes: this.changes });
        }
      });
    });
  } catch (error) {
    console.error('[DB] Run operation failed:', error.message);
    throw error;
  }
};

// Helper function to get single row
export const get = async (sql, params = []) => {
  if (!sql || typeof sql !== 'string') {
    throw new Error('SQL query must be a non-empty string');
  }

  // Ensure DB is initialized
  await getDbPromise();

  try {
    if (useTurso) {
      const res = await db.execute({ sql, args: params });
      // convert rows/columns to object rows
      const cols = res?.columns || [];
      console.log('[DB] Query columns:', cols.map(c => c.name));
      const rows = (res?.rows || []).map(r => {
        const obj = {};
        for (let i = 0; i < cols.length; i++) {
          obj[cols[i].name] = r[i];
        }
        console.log('[DB] Raw row data:', r);
        console.log('[DB] Mapped row:', obj);
        return convertBigIntToNumber(obj);
      });
      return rows[0] || null;
    }

    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          console.error('[DB] Get query failed:', sql.substring(0, 50), '...');
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  } catch (error) {
    console.error('[DB] Get operation failed:', error.message);
    throw error;
  }
};

// Helper function to get all rows
export const all = async (sql, params = []) => {
  if (!sql || typeof sql !== 'string') {
    throw new Error('SQL query must be a non-empty string');
  }

  // Ensure DB is initialized
  await getDbPromise();

  try {
    if (useTurso) {
      const res = await db.execute({ sql, args: params });
      const cols = res?.columns || [];
      const rows = (res?.rows || []).map(r => {
        const obj = {};
        for (let i = 0; i < cols.length; i++) {
          obj[cols[i].name] = r[i];
        }
        return convertBigIntToNumber(obj);
      });
      return rows;
    }

    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('[DB] All query failed:', sql.substring(0, 50), '...');
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  } catch (error) {
    console.error('[DB] All operation failed:', error.message);
    throw error;
  }
};

// Health check function for database connectivity
export const healthCheck = async () => {
  try {
    // Ensure DB is initialized
    await getDbPromise();

    if (useTurso) {
      await db.execute({ sql: "SELECT 1 as health_check", args: [] });
    } else {
      await new Promise((resolve, reject) => {
        db.get("SELECT 1 as health_check", (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    }

    return { status: 'healthy', database: useTurso ? 'turso' : 'sqlite' };
  } catch (error) {
    console.error('[DB] Health check failed:', error.message);
    return {
      status: 'unhealthy',
      database: useTurso ? 'turso' : 'sqlite',
      error: error.message
    };
  }
};

export default db;
