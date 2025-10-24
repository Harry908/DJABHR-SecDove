import express from 'express';
import { run, get, all } from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { normalizeUsername } from '../utils/username.js';

const router = express.Router();

// POST /api/conversations - Create a new conversation
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { conversation_entries } = req.body;
    const io = req.app.get('io');
    const currentUsername = normalizeUsername(req.user.username);

    const normalizedEntries = Array.isArray(conversation_entries)
      ? conversation_entries.map(entry => ({
          ...entry,
          username: normalizeUsername(entry?.username)
        }))
      : [];

    // Validate required fields
    if (!normalizedEntries.length) {
      return res.status(400).json({ error: 'Conversation entries array is required' });
    }

    // Validate each entry
    const conversationId = normalizedEntries[0].id;
    const contentKeyNumber = normalizedEntries[0].content_key_number || 1;

    for (const entry of normalizedEntries) {
      if (!entry.id || !entry.username || !entry.encrypted_content_key) {
        return res.status(400).json({ error: 'Invalid conversation entry format' });
      }
      if (entry.id !== conversationId) {
        return res.status(400).json({ error: 'All entries must have the same conversation ID' });
      }
    }

    // Validate that all usernames exist in the users table
    const uniqueUsernames = Array.from(new Set(normalizedEntries.map(entry => entry.username)));
    for (const username of uniqueUsernames) {
      const userExists = await get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [username]);
      if (!userExists) {
        return res.status(400).json({ error: `User ${username} not found` });
      }
    }

    // Verify current user is in the conversation
  const userInConversation = normalizedEntries.some(entry => entry.username === currentUsername);
    
    if (!userInConversation) {
      return res.status(403).json({ error: 'User must be a participant in the conversation' });
    }

    // Insert all conversation entries
    const timestamp = Date.now();
    for (const entry of normalizedEntries) {
      await run(
        `INSERT INTO conversations (id, content_key_number, username, encrypted_content_key, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [entry.id, contentKeyNumber, entry.username, entry.encrypted_content_key, timestamp]
      );
    }

    const participantUsernames = Array.from(new Set(normalizedEntries.map(entry => entry.username)));
    await broadcastToParticipants(conversationId, io, 'conversation-created', {
      participants: participantUsernames,
      content_key_number: contentKeyNumber,
      initiated_by: currentUsername
    });

    await run(
      `INSERT INTO conversation_events (conversation_id, type, actor_username, details, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [conversationId, 'conversation-created', currentUsername, JSON.stringify({ usernames: participantUsernames }), timestamp]
    );

    res.status(201).json({
      message: 'Conversation created successfully',
      conversation: {
        id: conversationId,
        content_key_number: contentKeyNumber,
        participants: normalizedEntries.map(e => e.username),
        created_at: timestamp
      }
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper to fetch latest key number for user in conversation
async function getLatestUserKey(conversationId, username) {
  const row = await get(
    `SELECT MAX(content_key_number) as max_key
     FROM conversations
     WHERE id = ? AND username = ? COLLATE NOCASE`,
    [conversationId, username]
  );
  return row?.max_key ?? null;
}

async function getConversationLatestKey(conversationId) {
  const row = await get(
    `SELECT MAX(content_key_number) as max_key
     FROM conversations
     WHERE id = ?`,
    [conversationId]
  );
  return row?.max_key ?? null;
}

async function broadcastToParticipants(conversationId, io, event, payload = {}) {
  if (!io) return;
  const participants = await all(
    'SELECT DISTINCT username FROM conversations WHERE id = ?',
    [conversationId]
  );
  participants.forEach(({ username }) => {
    const normalized = normalizeUsername(username);
    io.to(`user:${normalized}`).emit(event, { conversationId, ...payload });
  });
}

function validateBroadcastPayload(broadcast) {
  if (!broadcast) return null;
  if (typeof broadcast !== 'object') return 'Invalid broadcast payload';
  if (typeof broadcast.encrypted_msg_content !== 'string' || !broadcast.encrypted_msg_content.trim()) {
    return 'Encrypted broadcast content required';
  }
  if (typeof broadcast.content_key_number !== 'number') {
    return 'Broadcast content_key_number must be a number';
  }
  return null;
}

async function saveBroadcastMessage(conversationId, username, io, broadcast) {
  if (!broadcast) return null;
  const error = validateBroadcastPayload(broadcast);
  if (error) {
    const err = new Error(error);
    err.status = 400;
    throw err;
  }

  const normalizedUsername = normalizeUsername(username);

  const timestamp = Date.now();
  const result = await run(
    `INSERT INTO messages (conversation_id, content_key_number, encrypted_msg_content, sender_username, created_at, updated_at, is_deleted)
     VALUES (?, ?, ?, ?, ?, NULL, 0)`
    ,
    [conversationId, broadcast.content_key_number, broadcast.encrypted_msg_content, normalizedUsername, timestamp]
  );

  if (io) {
    io.to(`conversation:${conversationId}`).emit('new-message', {
      id: result.id,
      conversation_id: conversationId,
      content_key_number: broadcast.content_key_number,
      encrypted_msg_content: broadcast.encrypted_msg_content,
      sender_username: normalizedUsername,
      created_at: timestamp,
      updated_at: null,
      is_deleted: 0
    });
  }

  return { id: result.id, timestamp };
}

// GET /api/conversations - Get all conversations for current user
router.get('/', authenticateToken, async (req, res) => {
  try {
    const username = normalizeUsername(req.user.username);

    const userConversations = await all(
      `SELECT c1.id, c1.content_key_number, c1.encrypted_content_key, c1.created_at
       FROM conversations c1
       WHERE c1.username = ?
         AND c1.content_key_number = (
           SELECT MAX(c2.content_key_number)
           FROM conversations c2
           WHERE c2.id = c1.id AND c2.username = c1.username
         )
       ORDER BY c1.created_at DESC`,
      [username]
    );

    const conversationsWithParticipants = await Promise.all(
      userConversations.map(async (conv) => {
        const keyHistory = await all(
          `SELECT content_key_number, encrypted_content_key, created_at
           FROM conversations
           WHERE id = ? AND username = ?
           ORDER BY content_key_number ASC`,
          [conv.id, username]
        );

        const participants = await all(
          `SELECT username, encrypted_content_key
           FROM conversations
           WHERE id = ? AND content_key_number = ?`,
          [conv.id, conv.content_key_number]
        );

        return {
          id: conv.id,
          content_key_number: conv.content_key_number,
          encrypted_content_key: conv.encrypted_content_key,
          participants: participants.map(p => p.username),
          created_at: conv.created_at,
          keys: keyHistory
        };
      })
    );

    res.json({ conversations: conversationsWithParticipants });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/conversations/:conversationId - Get specific conversation details
router.get('/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const username = normalizeUsername(req.user.username);

    // Get user's entry for this conversation
    const userEntry = await get(
      `SELECT id, content_key_number, encrypted_content_key, created_at
       FROM conversations
       WHERE id = ? AND username = ?
       ORDER BY content_key_number DESC
       LIMIT 1`,
      [conversationId, username]
    );

    if (!userEntry) {
      return res.status(404).json({ error: 'Conversation not found or access denied' });
    }

    // Get all participants in this conversation
    const participants = await all(
      `SELECT username, encrypted_content_key
       FROM conversations
       WHERE id = ? AND content_key_number = ?`,
      [conversationId, userEntry.content_key_number]
    );

    const keyHistory = await all(
      `SELECT content_key_number, encrypted_content_key, created_at
       FROM conversations
       WHERE id = ? AND username = ?
       ORDER BY content_key_number ASC`,
      [conversationId, username]
    );

    res.json({
      conversation: {
        id: userEntry.id,
        content_key_number: userEntry.content_key_number,
        encrypted_content_key: userEntry.encrypted_content_key,
        participants: participants.map(p => p.username),
        created_at: userEntry.created_at,
        keys: keyHistory
      }
    });
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/conversations/:conversationId/participants - Add participant(s) or rotate key
router.post('/:conversationId/participants', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { share_history, entries, content_key_number, system_broadcast } = req.body;
    const io = req.app.get('io');

    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'Participant entries are required' });
    }

    const currentUsername = normalizeUsername(req.user.username);
    const normalizedEntries = entries.map(entry => ({
      ...entry,
      username: normalizeUsername(entry?.username),
      keys: Array.isArray(entry?.keys)
        ? entry.keys.map(keyEntry => ({
            ...keyEntry
          }))
        : entry?.keys
    }));

    const latestKeyNumber = await getLatestUserKey(conversationId, currentUsername);

    if (latestKeyNumber === null) {
      return res.status(404).json({ error: 'Conversation not found or access denied' });
    }

    const timestamp = Date.now();

    const validateEntry = async (entry, { requireEncryptedKey = true, requireKeys = false } = {}) => {
      if (!entry?.username || typeof entry.username !== 'string') {
        throw new Error('Invalid participant entry');
      }
      const userExists = await get('SELECT id FROM users WHERE username = ? COLLATE NOCASE', [entry.username]);
      if (!userExists) {
        throw new Error(`User ${entry.username} not found`);
      }
      if (requireEncryptedKey && !entry.encrypted_content_key) {
        throw new Error('Encrypted content key required');
      }
      if (requireKeys) {
        if (!Array.isArray(entry.keys) || entry.keys.length === 0) {
          throw new Error('keys array required when sharing history');
        }
        for (const keyEntry of entry.keys) {
          if (typeof keyEntry?.content_key_number !== 'number' || !keyEntry?.encrypted_content_key) {
            throw new Error('Invalid key entry format');
          }
        }
      }
    };

  if (share_history) {
      const allowedKeys = await all(
        `SELECT content_key_number, MIN(created_at) AS created_at
         FROM conversations
         WHERE id = ?
         GROUP BY content_key_number`,
        [conversationId]
      );

      if (allowedKeys.length === 0) {
        return res.status(400).json({ error: 'Conversation has no key history' });
      }

      const allowedMap = new Map();
      allowedKeys.forEach(row => {
        allowedMap.set(row.content_key_number, row.created_at);
      });

      for (const entry of normalizedEntries) {
        try {
          await validateEntry(entry, { requireEncryptedKey: false, requireKeys: true });
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }

        for (const keyEntry of entry.keys) {
          const keyNumber = keyEntry?.content_key_number;
          const encryptedKey = keyEntry?.encrypted_content_key;

          if (!allowedMap.has(keyNumber)) {
            return res.status(400).json({ error: `Unknown content key number ${keyNumber}` });
          }

          const alreadyParticipant = await get(
            `SELECT 1 FROM conversations WHERE id = ? AND content_key_number = ? AND username = ? COLLATE NOCASE`,
            [conversationId, keyNumber, entry.username]
          );

          if (alreadyParticipant) continue;

          await run(
            `INSERT INTO conversations (id, content_key_number, username, encrypted_content_key, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [conversationId, keyNumber, entry.username, encryptedKey, allowedMap.get(keyNumber) ?? timestamp]
          );
        }
      }

      const newUsernames = normalizedEntries.map(e => e.username);
      await broadcastToParticipants(conversationId, io, 'conversation-participants-added', {
        usernames: newUsernames,
        share_history: true,
        added_by: currentUsername
      });
      await broadcastToParticipants(conversationId, io, 'conversation-updated');

      await run(
        `INSERT INTO conversation_events (conversation_id, type, actor_username, details, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [conversationId, 'participant-added', currentUsername, JSON.stringify({ usernames: newUsernames, share_history: true }), Date.now()]
      );

      if (system_broadcast) {
        await saveBroadcastMessage(conversationId, currentUsername, io, system_broadcast);
      }

      return res.json({
        message: 'Participants added with existing history',
        share_history: true,
        participants: newUsernames
      });
    }

    if (typeof content_key_number !== 'number') {
      return res.status(400).json({ error: 'New content_key_number required when not sharing history' });
    }

    if (content_key_number <= latestKeyNumber) {
      return res.status(400).json({ error: 'New content key number must be greater than existing' });
    }

    const uniqueUsernames = new Set();
    for (const entry of normalizedEntries) {
      try {
        await validateEntry(entry, { requireEncryptedKey: true });
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      uniqueUsernames.add(entry.username);
    }

    if (!uniqueUsernames.has(currentUsername)) {
      return res.status(400).json({ error: 'Current user must be included when rotating key' });
    }

    for (const entry of normalizedEntries) {
      await run(
        `INSERT INTO conversations (id, content_key_number, username, encrypted_content_key, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [conversationId, content_key_number, entry.username, entry.encrypted_content_key, timestamp]
      );
    }

    const newUsernames = Array.from(uniqueUsernames);
    await broadcastToParticipants(conversationId, io, 'conversation-key-rotated', {
      content_key_number: content_key_number
    });
    await broadcastToParticipants(conversationId, io, 'conversation-participants-added', {
      usernames: newUsernames,
      share_history: false,
      added_by: currentUsername
    });
    await broadcastToParticipants(conversationId, io, 'conversation-updated');

    await run(
      `INSERT INTO conversation_events (conversation_id, type, actor_username, details, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [conversationId, 'participant-added', currentUsername, JSON.stringify({ usernames: newUsernames, share_history: false }), Date.now()]
    );

    if (system_broadcast) {
      await saveBroadcastMessage(conversationId, currentUsername, io, system_broadcast);
    }

    return res.json({
      message: 'Conversation key rotated',
      share_history: false,
      content_key_number,
      participants: newUsernames
    });
  } catch (error) {
    console.error('Update participants error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/conversations/:conversationId - Delete conversation (for current user)
router.delete('/:conversationId', authenticateToken, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const username = normalizeUsername(req.user.username);
    const { system_broadcast } = req.body ?? {};
    const io = req.app.get('io');

    const latestGlobalKey = await getConversationLatestKey(conversationId);
    if (latestGlobalKey === null) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const latestUserKey = await getLatestUserKey(conversationId, username);
    if (latestUserKey === null) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    if (latestUserKey !== latestGlobalKey) {
      return res.status(400).json({ error: 'Rotate to the latest key before leaving' });
    }

    await run(
      'DELETE FROM conversations WHERE id = ? AND username = ? COLLATE NOCASE',
      [conversationId, username]
    );

    await broadcastToParticipants(conversationId, io, 'conversation-participants-removed', {
      usernames: [username]
    });
    await broadcastToParticipants(conversationId, io, 'conversation-updated');
    await run(
      `INSERT INTO conversation_events (conversation_id, type, actor_username, details, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [conversationId, 'participant-removed', username, JSON.stringify({ usernames: [username] }), Date.now()]
    );

    if (system_broadcast) {
      await saveBroadcastMessage(conversationId, username, io, system_broadcast);
    }

    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
