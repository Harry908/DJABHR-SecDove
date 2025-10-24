import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// Resolve dirname without using import.meta so this works when compiled to
// CommonJS in serverless environments. Prefer process.cwd(), but fall back
// to __dirname when available.
const resolvedDirname = (typeof __dirname !== 'undefined') ? __dirname : process.cwd();
const dbPath = join(resolvedDirname, '..', 'database', 'securedove.db');

// Expected schema structure
const EXPECTED_TABLES = {
  users: [
    'id',
    'username',
    'password_hash',
    'public_key',
    'salt',
    'encrypted_private_key',
    'created_at'
  ],
  contacts: [
    'id',
    'user_id',
    'contact_user_id',
    'contact_username',
    'added_at'
  ],
  conversations: [
    'id',
    'content_key_number',
    'username',
    'encrypted_content_key',
    'created_at'
  ],
  messages: [
    'id',
    'conversation_id',
    'content_key_number',
    'encrypted_msg_content',
    'sender_username',
    'created_at',
    'updated_at',
    'is_deleted'
  ],
  conversation_events: [
    'id',
    'conversation_id',
    'type',
    'actor_username',
    'details',
    'created_at'
  ]
};

const EXPECTED_INDEXES = [
  'idx_users_username',
  'idx_contacts_user_id',
  'idx_conversations_username',
  'idx_conversations_id',
  'idx_messages_conversation',
  'idx_messages_created_at',
  'idx_events_conversation'
];

/**
 * Verify database integrity
 * @returns {Promise<{success: boolean, errors: string[]}>}
 */
export async function verifyDatabase() {
  const errors = [];
  
  return new Promise((resolve) => {
    // Check if database file exists
    if (!fs.existsSync(dbPath)) {
      errors.push('Database file does not exist');
      resolve({ success: false, errors });
      return;
    }

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        errors.push(`Cannot open database: ${err.message}`);
        resolve({ success: false, errors });
        return;
      }
    });

    // Enable foreign keys for this connection (required for SQLite)
    // This is a per-connection setting, not stored in the database file
    db.run('PRAGMA foreign_keys = ON', (err) => {
      if (err) {
        errors.push(`Cannot enable foreign keys: ${err.message}`);
      }

      // Verify tables exist
      db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
        if (err) {
          errors.push(`Cannot query tables: ${err.message}`);
          db.close();
          resolve({ success: false, errors });
          return;
        }

        const tableNames = tables.map(t => t.name);
        
        // Check if all expected tables exist
        for (const tableName of Object.keys(EXPECTED_TABLES)) {
          if (!tableNames.includes(tableName)) {
            errors.push(`Table '${tableName}' is missing`);
          }
        }

        // Verify table schemas
        const schemaChecks = Object.keys(EXPECTED_TABLES).map(tableName => {
          return new Promise((resolveTable) => {
            if (!tableNames.includes(tableName)) {
              resolveTable();
              return;
            }

            db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
              if (err) {
                errors.push(`Cannot get schema for table '${tableName}': ${err.message}`);
                resolveTable();
                return;
              }

              const columnNames = columns.map(c => c.name);
              const expectedColumns = EXPECTED_TABLES[tableName];

              // Check if all expected columns exist
              for (const colName of expectedColumns) {
                if (!columnNames.includes(colName)) {
                  errors.push(`Column '${colName}' is missing in table '${tableName}'`);
                }
              }

              resolveTable();
            });
          });
        });

        // Verify indexes exist
        Promise.all(schemaChecks).then(() => {
          db.all("SELECT name FROM sqlite_master WHERE type='index'", (err, indexes) => {
            if (err) {
              errors.push(`Cannot query indexes: ${err.message}`);
            } else {
              const indexNames = indexes.map(i => i.name);
              
              for (const indexName of EXPECTED_INDEXES) {
                if (!indexNames.includes(indexName)) {
                  errors.push(`Index '${indexName}' is missing`);
                }
              }
            }

            db.close((closeErr) => {
              if (closeErr) {
                errors.push(`Error closing database: ${closeErr.message}`);
              }
              
              resolve({ 
                success: errors.length === 0, 
                errors 
              });
            });
          });
        });
      });
    });
  });
}

/**
 * Initialize database if it doesn't exist or is corrupted
 * @returns {Promise<boolean>}
 */
export async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    // Ensure database directory exists
    const dbDir = dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON', (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          public_key TEXT NOT NULL,
          salt TEXT NOT NULL,
          encrypted_private_key TEXT NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
      `);

      // Contacts table
      db.run(`
        CREATE TABLE IF NOT EXISTS contacts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          contact_user_id INTEGER NOT NULL,
          contact_username TEXT NOT NULL,
          added_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (contact_user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, contact_user_id)
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)
      `);

      // Conversations table
      db.run(`
        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER NOT NULL,
          content_key_number INTEGER NOT NULL,
          username TEXT NOT NULL,
          encrypted_content_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (id, content_key_number, username),
          FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_conversations_username ON conversations(username)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_conversations_id ON conversations(id)
      `);

      // Messages table
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL,
          content_key_number INTEGER NOT NULL,
          encrypted_msg_content TEXT NOT NULL,
          sender_username TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER,
          is_deleted INTEGER DEFAULT 0
        )
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, content_key_number)
      `);

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)
      `);

      db.run(`ALTER TABLE messages ADD COLUMN sender_username TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          db.close(() => reject(err));
          return;
        }

        db.run(`
          CREATE TABLE IF NOT EXISTS conversation_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            actor_username TEXT,
            details TEXT,
            created_at INTEGER NOT NULL
          )
        `, (eventErr) => {
          if (eventErr) {
            db.close(() => reject(eventErr));
            return;
          }

          db.run(`
            CREATE INDEX IF NOT EXISTS idx_events_conversation ON conversation_events(conversation_id, created_at)
          `, (idxErr) => {
            if (idxErr) {
              db.close(() => reject(idxErr));
              return;
            }

            db.close((closeErr) => {
              if (closeErr) {
                reject(closeErr);
              } else {
                resolve(true);
              }
            });
          });
        });
      });
    });
  });
}

/**
 * Verify database or initialize if needed
 * @returns {Promise<void>}
 */
export async function ensureDatabaseIntegrity() {
  console.log('🔍 Verifying database integrity...');
  
  const verification = await verifyDatabase();
  
  if (verification.success) {
    console.log('✅ Database integrity verified');
    return;
  }
  
  console.log('⚠️  Database issues found:');
  verification.errors.forEach(error => {
    console.log(`   - ${error}`);
  });
  
  console.log('🔧 Initializing/repairing database...');
  
  try {
    await initializeDatabase();
    
    // Verify again after initialization
    const recheck = await verifyDatabase();
    
    if (recheck.success) {
      console.log('✅ Database initialized successfully');
    } else {
      console.error('❌ Database initialization failed:');
      recheck.errors.forEach(error => {
        console.error(`   - ${error}`);
      });
      throw new Error('Database initialization failed');
    }
  } catch (error) {
    console.error('❌ Fatal database error:', error.message);
    throw error;
  }
}
