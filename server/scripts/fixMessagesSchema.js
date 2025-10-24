import sqlite3 from 'sqlite3';
import { join } from 'path';

// Use process.cwd() to locate the database so this script works in both ESM
// and CommonJS compiled runtimes.
const dbPath = join(process.cwd(), 'database', 'securedove.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = OFF', (err) => {
  if (err) {
    console.error('Error disabling foreign keys:', err);
    process.exit(1);
  }
  console.log('Foreign keys disabled for migration');
});

db.serialize(() => {
  console.log('Starting messages table schema migration...');

  // Begin transaction
  db.run('BEGIN TRANSACTION', (err) => {
    if (err) {
      console.error('Error starting transaction:', err);
      process.exit(1);
    }
  });

  // Create new messages table with correct foreign key
  db.run(`
    CREATE TABLE messages_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      content_key_number INTEGER NOT NULL,
      encrypted_msg_content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      is_deleted INTEGER DEFAULT 0
    )
  `, (err) => {
    if (err) {
      console.error('Error creating new messages table:', err);
      db.run('ROLLBACK');
      process.exit(1);
    }
    console.log('✓ Created new messages table');
  });

  // Copy data from old table to new table
  db.run(`
    INSERT INTO messages_new (id, conversation_id, content_key_number, encrypted_msg_content, created_at, updated_at, is_deleted)
    SELECT id, conversation_id, content_key_number, encrypted_msg_content, created_at, updated_at, is_deleted
    FROM messages
  `, (err) => {
    if (err) {
      console.error('Error copying data:', err);
      db.run('ROLLBACK');
      process.exit(1);
    }
    console.log('✓ Copied data to new table');
  });

  // Drop old table
  db.run('DROP TABLE messages', (err) => {
    if (err) {
      console.error('Error dropping old table:', err);
      db.run('ROLLBACK');
      process.exit(1);
    }
    console.log('✓ Dropped old messages table');
  });

  // Rename new table to messages
  db.run('ALTER TABLE messages_new RENAME TO messages', (err) => {
    if (err) {
      console.error('Error renaming table:', err);
      db.run('ROLLBACK');
      process.exit(1);
    }
    console.log('✓ Renamed new table to messages');
  });

  // Recreate indexes
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)
  `, (err) => {
    if (err) {
      console.error('Error creating messages index:', err);
      db.run('ROLLBACK');
      process.exit(1);
    }
    console.log('✓ Recreated messages conversation index');
  });

  // Commit transaction
  db.run('COMMIT', (err) => {
    if (err) {
      console.error('Error committing transaction:', err);
      db.run('ROLLBACK');
      process.exit(1);
    }
    console.log('✓ Transaction committed');
  });

  // Re-enable foreign keys
  db.run('PRAGMA foreign_keys = ON', (err) => {
    if (err) {
      console.error('Error enabling foreign keys:', err);
      process.exit(1);
    }
    console.log('✓ Foreign keys re-enabled');
    
    console.log('\n✅ Messages table schema migration completed successfully!');
    
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
        process.exit(1);
      }
      console.log('Database connection closed');
      process.exit(0);
    });
  });
});
