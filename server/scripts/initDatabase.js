import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import fs from 'fs';

// Resolve DB path relative to current working directory to avoid using
// import.meta.url which isn't available in some compiled environments.
const dbPath = join(process.cwd(), 'database', 'securedove.db');

// Ensure database directory exists
const dbDir = dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON', (err) => {
  if (err) {
    console.error('Error enabling foreign keys:', err);
    process.exit(1);
  }
  console.log('Foreign keys enabled');
});

// Create tables
const createTables = () => {
  return new Promise((resolve, reject) => {
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
      `, (err) => {
        if (err) {
          console.error('Error creating users table:', err);
          reject(err);
          return;
        }
        console.log('✓ Users table created');
      });

      // Create index on username
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)
      `, (err) => {
        if (err) console.error('Error creating users index:', err);
        else console.log('✓ Users username index created');
      });

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
      `, (err) => {
        if (err) {
          console.error('Error creating contacts table:', err);
          reject(err);
          return;
        }
        console.log('✓ Contacts table created');
      });

      // Create index on user_id
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts(user_id)
      `, (err) => {
        if (err) console.error('Error creating contacts index:', err);
        else console.log('✓ Contacts user_id index created');
      });

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
      `, (err) => {
        if (err) {
          console.error('Error creating conversations table:', err);
          reject(err);
          return;
        }
        console.log('✓ Conversations table created');
      });

      // Create indexes on conversations
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_conversations_username ON conversations(username)
      `, (err) => {
        if (err) console.error('Error creating conversations username index:', err);
        else console.log('✓ Conversations username index created');
      });

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_conversations_id ON conversations(id)
      `, (err) => {
        if (err) console.error('Error creating conversations id index:', err);
        else console.log('✓ Conversations id index created');
      });

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
      `, (err) => {
        if (err) {
          console.error('Error creating messages table:', err);
          reject(err);
          return;
        }
        console.log('✓ Messages table created');
      });

      // Create indexes on messages
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, content_key_number)
      `, (err) => {
        if (err) console.error('Error creating messages conversation index:', err);
        else console.log('✓ Messages conversation index created');
      });

      db.run(`
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)
      `, (err) => {
        if (err) {
          console.error('Error creating messages created_at index:', err);
          reject(err);
          return;
        }
        db.run('ALTER TABLE messages ADD COLUMN sender_username TEXT', (alterErr) => {
          if (alterErr && !alterErr.message.includes('duplicate column')) {
            console.error('Error adding sender_username column:', alterErr);
            reject(alterErr);
            return;
          }
          console.log('✓ Messages created_at index created');

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
              console.error('Error creating conversation_events table:', eventErr);
              reject(eventErr);
              return;
            }
            db.run(`
              CREATE INDEX IF NOT EXISTS idx_events_conversation ON conversation_events(conversation_id, created_at)
            `, (idxErr) => {
              if (idxErr) {
                console.error('Error creating conversation_events index:', idxErr);
                reject(idxErr);
              } else {
                console.log('✓ conversation_events table and index created');
                resolve();
              }
            });
          });
        });
      });
    });
  });
};

// Initialize database
createTables()
  .then(() => {
    console.log('\n✅ Database initialized successfully!');
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
      }
      console.log('Database connection closed');
      process.exit(0);
    });
  })
  .catch((err) => {
    console.error('\n❌ Database initialization failed:', err);
    db.close();
    process.exit(1);
  });
