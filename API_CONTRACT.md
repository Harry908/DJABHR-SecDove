# SecureDove API Contract

This document outlines the complete API specification for the SecureDove messaging application, including all endpoints, request/response formats, and data structures.

## Base URL
- Production: `https://your-vercel-app.vercel.app`
- Development: `http://localhost:3001`

## Authentication
All endpoints except `/api/auth/register`, `/api/auth/login`, `/api/auth/check-username`, and `/api/health` require JWT authentication via the `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

## Error Response Format
All error responses follow this format:
```json
{
  "error": "Error message description"
}
```

---

## Authentication Endpoints

### POST /api/auth/register
Register a new user account.

**Request Body:**
```json
{
  "username": "string (required, 3-20 chars, alphanumeric + underscore + hyphen)",
  "password": "string (required, min 8 chars)",
  "public_key": "string (required, user's public key for E2E encryption)",
  "salt": "string (required, salt for password hashing)",
  "encrypted_private_key": "string (required, encrypted private key)"
}
```

**Success Response (201):**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "number",
    "username": "string",
    "public_key": "string",
    "salt": "string",
    "encrypted_private_key": "string",
    "created_at": "number (timestamp)"
  },
  "token": "string (JWT token)"
}
```

**Error Responses:**
- 400: Invalid input data
- 409: Username already exists
- 500: Internal server error

### POST /api/auth/login
Authenticate user and return JWT token.

**Request Body:**
```json
{
  "username": "string (required)",
  "password": "string (required)"
}
```

**Success Response (200):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "number",
    "username": "string",
    "public_key": "string",
    "created_at": "number (timestamp)"
  },
  "token": "string (JWT token)"
}
```

**Error Responses:**
- 400: Invalid credentials
- 401: Authentication failed
- 500: Internal server error

### GET /api/auth/user
Get current authenticated user's profile.

**Success Response (200):**
```json
{
  "user": {
    "id": "number",
    "username": "string",
    "public_key": "string",
    "created_at": "number (timestamp)"
  }
}
```

**Error Responses:**
- 401: Unauthorized
- 500: Internal server error

### POST /api/auth/logout
Logout user (client-side token removal).

**Success Response (200):**
```json
{
  "message": "Logout successful"
}
```

### GET /api/auth/check-username
Check if a username is available.

**Query Parameters:**
- `username` (required): Username to check

**Success Response (200):**
```json
{
  "available": "boolean",
  "username": "string"
}
```

**Error Responses:**
- 400: Username parameter required
- 500: Internal server error

---

## Contact Management Endpoints

### POST /api/contacts
Add a new contact.

**Request Body:**
```json
{
  "contact_username": "string (required, contact's username)"
}
```

**Success Response (201):**
```json
{
  "message": "Contact added successfully",
  "contact": {
    "id": "number",
    "contact_user_id": "number",
    "contact_username": "string",
    "public_key": "string",
    "added_at": "number (timestamp)"
  }
}
```

**Error Responses:**
- 400: Invalid input or user not found
- 401: Unauthorized
- 409: Contact already exists
- 500: Internal server error

### GET /api/contacts
Get all contacts for the authenticated user.

**Success Response (200):**
```json
{
  "contacts": [
    {
      "id": "number",
      "contact_user_id": "number",
      "contact_username": "string",
      "public_key": "string",
      "added_at": "number (timestamp)"
    }
  ]
}
```

**Error Responses:**
- 401: Unauthorized
- 500: Internal server error

### DELETE /api/contacts/:contactId
Remove a contact.

**URL Parameters:**
- `contactId`: Contact ID to remove

**Success Response (200):**
```json
{
  "message": "Contact removed successfully"
}
```

**Error Responses:**
- 401: Unauthorized
- 404: Contact not found
- 500: Internal server error

### GET /api/contacts/:username/public-key
Get a user's public key.

**URL Parameters:**
- `username`: Username to get public key for

**Success Response (200):**
```json
{
  "username": "string",
  "public_key": "string"
}
```

**Error Responses:**
- 401: Unauthorized
- 404: User not found
- 500: Internal server error

---

## Conversation Management Endpoints

### POST /api/conversations
Create a new conversation.

**Request Body:**
```json
{
  "conversation_entries": [
    {
      "id": "string (required, conversation ID)",
      "username": "string (required, participant username)",
      "encrypted_content_key": "string (required, encrypted content key)"
    }
  ]
}
```

**Success Response (201):**
```json
{
  "message": "Conversation created successfully",
  "conversation": {
    "id": "string",
    "content_key_number": "number",
    "participants": ["string"],
    "created_at": "number (timestamp)"
  }
}
```

**Error Responses:**
- 400: Invalid conversation entries
- 401: Unauthorized
- 403: User not a participant
- 500: Internal server error

### GET /api/conversations
Get all conversations for the authenticated user.

**Success Response (200):**
```json
{
  "conversations": [
    {
      "id": "string",
      "content_key_number": "number",
      "encrypted_content_key": "string",
      "participants": ["string"],
      "created_at": "number (timestamp)",
      "keys": [
        {
          "content_key_number": "number",
          "encrypted_content_key": "string",
          "created_at": "number (timestamp)"
        }
      ]
    }
  ]
}
```

**Error Responses:**
- 401: Unauthorized
- 500: Internal server error

### GET /api/conversations/:conversationId
Get details for a specific conversation.

**URL Parameters:**
- `conversationId`: Conversation ID

**Success Response (200):**
```json
{
  "conversation": {
    "id": "string",
    "content_key_number": "number",
    "encrypted_content_key": "string",
    "participants": ["string"],
    "created_at": "number (timestamp)",
    "keys": [
      {
        "content_key_number": "number",
        "encrypted_content_key": "string",
        "created_at": "number (timestamp)"
      }
    ]
  }
}
```

**Error Responses:**
- 401: Unauthorized
- 404: Conversation not found
- 500: Internal server error

### POST /api/conversations/:conversationId/participants
Add participants to a conversation or rotate encryption key.

**URL Parameters:**
- `conversationId`: Conversation ID

**Request Body (Add with history):**
```json
{
  "share_history": true,
  "entries": [
    {
      "username": "string (required)",
      "keys": [
        {
          "content_key_number": "number",
          "encrypted_content_key": "string"
        }
      ]
    }
  ],
  "system_broadcast": {
    "encrypted_msg_content": "string",
    "content_key_number": "number"
  }
}
```

**Request Body (Rotate key):**
```json
{
  "share_history": false,
  "entries": [
    {
      "username": "string (required)",
      "encrypted_content_key": "string (required)"
    }
  ],
  "content_key_number": "number (required)",
  "system_broadcast": {
    "encrypted_msg_content": "string",
    "content_key_number": "number"
  }
}
```

**Success Response (200):**
```json
{
  "message": "Participants added with existing history" | "Conversation key rotated",
  "share_history": "boolean",
  "content_key_number": "number (if rotated)",
  "participants": ["string"]
}
```

**Error Responses:**
- 400: Invalid input data
- 401: Unauthorized
- 404: Conversation not found
- 500: Internal server error

### DELETE /api/conversations/:conversationId
Remove user from a conversation.

**URL Parameters:**
- `conversationId`: Conversation ID

**Request Body (optional):**
```json
{
  "system_broadcast": {
    "encrypted_msg_content": "string",
    "content_key_number": "number"
  }
}
```

**Success Response (200):**
```json
{
  "message": "Conversation deleted successfully"
}
```

**Error Responses:**
- 400: Must rotate to latest key first
- 401: Unauthorized
- 404: Conversation not found
- 500: Internal server error

---

## Message Endpoints

### POST /api/messages
Send a new message.

**Request Body:**
```json
{
  "conversation_id": "string (required)",
  "content_key_number": "number (required)",
  "encrypted_msg_content": "string (required)"
}
```

**Success Response (201):**
```json
{
  "message": "Message sent successfully",
  "messageData": {
    "id": "number",
    "conversation_id": "string",
    "content_key_number": "number",
    "encrypted_msg_content": "string",
    "sender_username": "string",
    "created_at": "number (timestamp)",
    "is_deleted": "number (0)"
  }
}
```

**Error Responses:**
- 400: Missing required fields
- 401: Unauthorized
- 403: Access denied to conversation
- 500: Internal server error

### GET /api/messages/:conversationId
Get messages for a conversation.

**URL Parameters:**
- `conversationId`: Conversation ID

**Query Parameters:**
- `limit` (optional): Number of messages to return (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Success Response (200):**
```json
{
  "messages": [
    {
      "id": "number",
      "conversation_id": "string",
      "content_key_number": "number",
      "encrypted_msg_content": "string",
      "sender_username": "string",
      "created_at": "number (timestamp)",
      "updated_at": "number (timestamp) | null",
      "is_deleted": "number (0 or 1)"
    }
  ],
  "pagination": {
    "total": "number",
    "limit": "number",
    "offset": "number"
  }
}
```

**Error Responses:**
- 401: Unauthorized
- 403: Access denied to conversation
- 500: Internal server error

### PUT /api/messages/:messageId
Update/edit a message.

**URL Parameters:**
- `messageId`: Message ID to update

**Request Body:**
```json
{
  "encrypted_msg_content": "string (required)"
}
```

**Success Response (200):**
```json
{
  "message": "Message updated successfully",
  "messageData": {
    "id": "number",
    "encrypted_msg_content": "string",
    "updated_at": "number (timestamp)"
  }
}
```

**Error Responses:**
- 400: Missing content
- 401: Unauthorized
- 403: Not message sender
- 404: Message not found
- 500: Internal server error

### DELETE /api/messages/:messageId
Soft delete a message.

**URL Parameters:**
- `messageId`: Message ID to delete

**Success Response (200):**
```json
{
  "message": "Message deleted successfully"
}
```

**Error Responses:**
- 401: Unauthorized
- 403: Not message sender
- 404: Message not found
- 500: Internal server error

### GET /api/messages/recent/all
Get recent messages across all user's conversations.

**Query Parameters:**
- `limit` (optional): Number of messages to return (default: 20)

**Success Response (200):**
```json
{
  "messages": [
    {
      "id": "number",
      "conversation_id": "string",
      "content_key_number": "number",
      "encrypted_msg_content": "string",
      "created_at": "number (timestamp)",
      "updated_at": "number (timestamp) | null"
    }
  ]
}
```

**Error Responses:**
- 401: Unauthorized
- 500: Internal server error

---

## Health Check Endpoints

### GET /api/health
Health check endpoint.

**Success Response (200):**
```json
{
  "ok": true,
  "timestamp": "number"
}
```

### GET /api/test
Test endpoint.

**Success Response (200):**
```json
{
  "message": "Hello from test function"
}
```

---

## WebSocket Events

The application uses Socket.IO for real-time communication. All events are emitted to conversation rooms.

### Connection
- Namespace: `/`
- Authentication: JWT token in handshake query

### Events

#### Conversation Events
- `conversation-created`: New conversation created
- `conversation-updated`: Conversation modified
- `conversation-participants-added`: New participants added
- `conversation-participants-removed`: Participants removed
- `conversation-key-rotated`: Encryption key rotated

#### Message Events
- `new-message`: New message sent
- `message-updated`: Message edited
- `message-deleted`: Message deleted

### Room Structure
- User rooms: `user:{normalized_username}`
- Conversation rooms: `conversation:{conversation_id}`

---

## Data Types

### User
```json
{
  "id": "number",
  "username": "string",
  "public_key": "string",
  "salt": "string",
  "encrypted_private_key": "string",
  "created_at": "number (timestamp)"
}
```

### Contact
```json
{
  "id": "number",
  "contact_user_id": "number",
  "contact_username": "string",
  "public_key": "string",
  "added_at": "number (timestamp)"
}
```

### Conversation
```json
{
  "id": "string",
  "content_key_number": "number",
  "encrypted_content_key": "string",
  "participants": ["string"],
  "created_at": "number (timestamp)",
  "keys": [
    {
      "content_key_number": "number",
      "encrypted_content_key": "string",
      "created_at": "number (timestamp)"
    }
  ]
}
```

### Message
```json
{
  "id": "number",
  "conversation_id": "string",
  "content_key_number": "number",
  "encrypted_msg_content": "string",
  "sender_username": "string",
  "created_at": "number (timestamp)",
  "updated_at": "number (timestamp) | null",
  "is_deleted": "number (0 or 1)"
}
```

---

## Rate Limiting
All endpoints are protected by rate limiting middleware. Default limits:
- General endpoints: 100 requests per 15 minutes per IP
- Authentication endpoints: 10 requests per 15 minutes per IP

## CORS
All endpoints support CORS with the following configuration:
- Origins: Configured via environment variables
- Methods: GET, POST, PUT, DELETE, OPTIONS
- Headers: Content-Type, Authorization

## Security Notes
- All sensitive data is end-to-end encrypted
- JWT tokens expire after 24 hours
- Passwords are hashed with bcrypt
- All database queries use parameterized statements
- Input validation on all endpoints</content>
<parameter name="filePath">d:\Desktop\DJABHR-SecDove\API_CONTRACT.md