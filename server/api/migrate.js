import { run, all } from '../../config/database.js';

export default async function handler(req, res) {
  // Only allow POST requests and require admin authentication
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin check - you should replace this with proper authentication
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  console.log('🔧 Starting database migration to remove username FK constraints...');

  try {
    // Get all existing data before recreating tables
    console.log('Backing up existing data...');
    const users = await all('SELECT * FROM users');
    const contacts = await all('SELECT * FROM contacts');
    const conversations = await all('SELECT * FROM conversations');
    const messages = await all('SELECT * FROM messages');
    const events = await all('SELECT * FROM conversation_events');

    console.log(`Found ${users.length} users, ${contacts.length} contacts, ${conversations.length} conversations, ${messages.length} messages, ${events.length} events`);

    // Recreate tables without username foreign key constraints
    console.log('Recreating tables...');

    const recreateStatements = [
      // Drop existing tables (in correct order due to FK constraints)
      'DROP TABLE IF EXISTS conversation_events',
      'DROP TABLE IF EXISTS messages',
      'DROP TABLE IF EXISTS conversations',
      'DROP TABLE IF EXISTS contacts',
      'DROP TABLE IF EXISTS users',

      // Recreate users table
      `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        public_key TEXT NOT NULL,
        salt TEXT NOT NULL,
        encrypted_private_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,

      `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`,

      // Recreate contacts table (keeping ID-based FK constraints)
      `CREATE TABLE contacts (
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

      // Recreate conversations table WITHOUT username FK constraint
      `CREATE TABLE conversations (
        id INTEGER NOT NULL,
        content_key_number INTEGER NOT NULL,
        username TEXT NOT NULL COLLATE NOCASE,
        encrypted_content_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (id, content_key_number, username)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_conversations_username ON conversations(username)`,
      `CREATE INDEX IF NOT EXISTS idx_conversations_id ON conversations(id)`,

      // Recreate messages table WITHOUT sender_username FK constraint
      `CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        content_key_number INTEGER NOT NULL,
        encrypted_msg_content TEXT NOT NULL,
        sender_username TEXT COLLATE NOCASE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER,
        is_deleted INTEGER DEFAULT 0
      )`,

      `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, content_key_number)`,
      `CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)`,

      // Recreate conversation_events table WITHOUT actor_username FK constraint
      `CREATE TABLE conversation_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor_username TEXT COLLATE NOCASE,
        details TEXT,
        created_at INTEGER NOT NULL
      )`,

      `CREATE INDEX IF NOT EXISTS idx_events_conversation ON conversation_events(conversation_id, created_at)`
    ];

    // Execute recreation
    for (const sql of recreateStatements) {
      await run(sql);
    }

    // Restore data
    console.log('Restoring data...');

    // Insert users
    for (const user of users) {
      await run(
        'INSERT INTO users (id, username, password_hash, public_key, salt, encrypted_private_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user.id, user.username, user.password_hash, user.public_key, user.salt, user.encrypted_private_key, user.created_at]
      );
    }

    // Insert contacts
    for (const contact of contacts) {
      await run(
        'INSERT INTO contacts (id, user_id, contact_user_id, contact_username, added_at) VALUES (?, ?, ?, ?, ?)',
        [contact.id, contact.user_id, contact.contact_user_id, contact.contact_username, contact.added_at]
      );
    }

    // Insert conversations
    for (const conv of conversations) {
      await run(
        'INSERT INTO conversations (id, content_key_number, username, encrypted_content_key, created_at) VALUES (?, ?, ?, ?, ?)',
        [conv.id, conv.content_key_number, conv.username, conv.encrypted_content_key, conv.created_at]
      );
    }

    // Insert messages
    for (const msg of messages) {
      await run(
        'INSERT INTO messages (id, conversation_id, content_key_number, encrypted_msg_content, sender_username, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [msg.id, msg.conversation_id, msg.content_key_number, msg.encrypted_msg_content, msg.sender_username, msg.created_at, msg.updated_at, msg.is_deleted]
      );
    }

    // Insert events
    for (const event of events) {
      await run(
        'INSERT INTO conversation_events (id, conversation_id, type, actor_username, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [event.id, event.conversation_id, event.type, event.actor_username, event.details, event.created_at]
      );
    }

    console.log('✅ Database migration completed successfully!');
    res.json({
      success: true,
      message: 'Database migrated successfully',
      data_restored: {
        users: users.length,
        contacts: contacts.length,
        conversations: conversations.length,
        messages: messages.length,
        events: events.length
      }
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      details: error.message
    });
  }
}