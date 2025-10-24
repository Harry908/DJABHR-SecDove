// API client using fetch
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

async function request(path, { method = 'GET', body, params } = {}) {
  const url = new URL(API_BASE_URL + path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const resp = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await resp.text();
  let data = {};

  // Try to parse JSON, but handle cases where server returns HTML error pages
  try {
    data = text ? JSON.parse(text) : {};
  } catch (parseError) {
    // If JSON parsing fails, check if we got HTML (common for 404/500 errors)
    const isHTML = text.trim().startsWith('<');
    if (isHTML) {
      // Server returned HTML instead of JSON (likely an error page)
      const error = new Error(
        `Server returned HTML instead of JSON (Status ${resp.status}). ` +
        `This usually indicates a routing issue or server error. ` +
        `Expected endpoint: ${url.toString()}`
      );
      error.response = {
        status: resp.status,
        data: { error: 'Invalid response format', rawText: text.substring(0, 200) }
      };
      throw error;
    } else {
      // Non-HTML, non-JSON response
      const error = new Error(
        `Failed to parse server response as JSON (Status ${resp.status}). ` +
        `Response: ${text.substring(0, 100)}`
      );
      error.response = {
        status: resp.status,
        data: { error: 'Invalid JSON response', rawText: text.substring(0, 200) }
      };
      throw error;
    }
  }

  if (!resp.ok) {
    const error = new Error(data?.error || resp.statusText);
    error.response = { status: resp.status, data };
    throw error;
  }
  return data;
}

// ============= Authentication APIs =============

export const authAPI = {
  register: async (userData) => {
    return await request('/auth/register', { method: 'POST', body: userData });
  },
  
  login: async (credentials) => {
    return await request('/auth/login', { method: 'POST', body: credentials });
  },
  
  getUser: async () => {
    return await request('/auth/user');
  },
  
  logout: async () => {
    return await request('/auth/logout', { method: 'POST' });
  },

  checkUsername: async (username) => {
    return await request(`/auth/check-username`, { params: { username } });
  }
};

// ============= Contacts APIs =============

export const contactsAPI = {
  addContact: async (contactUsername) => {
    return await request('/contacts', { method: 'POST', body: { contact_username: contactUsername } });
  },
  
  getContacts: async () => {
    return await request('/contacts');
  },
  
  deleteContact: async (contactId) => {
    return await request(`/contacts/${contactId}`, { method: 'DELETE' });
  },
  
  getPublicKey: async (username) => {
    return await request(`/contacts/${username}/public-key`);
  }
};

// ============= Conversations APIs =============

export const conversationsAPI = {
  createConversation: async (conversationEntries) => {
    return await request('/conversations', { method: 'POST', body: { conversation_entries: conversationEntries } });
  },
  
  getConversations: async () => {
    return await request('/conversations');
  },
  
  getConversation: async (conversationId) => {
    return await request(`/conversations/${conversationId}`);
  },
  
  deleteConversation: async (conversationId, payload) => {
    return await request(`/conversations/${conversationId}`, {
      method: 'DELETE',
      body: payload
    });
  },

  addParticipants: async (conversationId, payload) => {
    return await request(`/conversations/${conversationId}/participants`, {
      method: 'POST',
      body: payload
    });
  }
};

// ============= Messages APIs =============

export const messagesAPI = {
  sendMessage: async (messageData) => {
    return await request('/messages', { method: 'POST', body: messageData });
  },
  
  getMessages: async (conversationId, limit = 50, offset = 0) => {
    return await request(`/messages/${conversationId}`, { params: { limit, offset } });
  },
  
  updateMessage: async (messageId, encryptedContent) => {
    return await request(`/messages/${messageId}`, { method: 'PUT', body: { encrypted_msg_content: encryptedContent } });
  },
  
  deleteMessage: async (messageId) => {
    return await request(`/messages/${messageId}`, { method: 'DELETE' });
  },
  
  getRecentMessages: async (limit = 20) => {
    return await request('/messages/recent/all', { params: { limit } });
  }
};
