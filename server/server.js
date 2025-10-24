import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import { apiLimiter } from './middleware/rateLimiter.js';
import { ensureDatabaseIntegrity } from './utils/databaseVerification.js';
import { healthCheck } from './config/database.js';
import { verifyToken } from './utils/auth.js';
import authRoutes from './routes/auth.js';
import contactsRoutes from './routes/contacts.js';
import conversationsRoutes from './routes/conversations.js';
import messagesRoutes from './routes/messages.js';
import { getEnv } from './config/env.js';

const app = express();
// Behind Vercel or proxy platforms, trust proxy so express-rate-limit can
// correctly extract client IPs from X-Forwarded-For. For security, only trust
// the first proxy (Vercel's proxy) in serverless environments.
if (process.env.VERCEL) {
  app.set('trust proxy', 1); // Trust only the first proxy
} else {
  app.set('trust proxy', true); // Trust all proxies in development
}
const httpServer = createServer(app);
const nodeEnv = getEnv('NODE_ENV', 'development');
const isDevelopment = nodeEnv === 'development';
const PORT = Number.parseInt(getEnv('PORT', 3000), 10);

// Log database mode at startup to make Vercel logs clearer
const _tursoUrl = getEnv('TURSO_DATABASE_URL', '');
if (_tursoUrl) {
  console.log(`[DB MODE] Using Turso (libSQL) at: ${_tursoUrl}`);
} else {
  console.log(`[DB MODE] Using local SQLite. DB_PATH=${getEnv('DB_PATH', 'default')}`);
}

// CORS origin can be a single origin or comma-separated list of origins
const DEFAULT_ORIGIN = 'https://secdove-frontend.vercel.app';
const corsOriginEnv = getEnv('CORS_ORIGIN', DEFAULT_ORIGIN);

const normalizeOrigin = (origin) => {
  if (!origin) return '';
  return origin.trim().replace(/\/$/, '');
};

const parseOrigins = (value) => {
  if (!value) return [];
  return value.split(',')
    .map(item => normalizeOrigin(item))
    .filter(Boolean);
};

const configuredOrigins = parseOrigins(corsOriginEnv);
const allowedOriginsList = configuredOrigins.length > 0 ? configuredOrigins : [DEFAULT_ORIGIN];
const allowedOriginsSet = new Set(allowedOriginsList.map(origin => origin.toLowerCase()));

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  const normalizedOrigin = normalizeOrigin(origin).toLowerCase();
  return allowedOriginsSet.has('*') || allowedOriginsSet.has(normalizedOrigin);
};

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        console.warn(`Socket.IO blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['polling'], // Force polling transport for Vercel compatibility
  allowUpgrades: false // Disable WebSocket upgrade attempts
});
app.set('io', io);

const corsMiddleware = (req, res, next) => {
  const requestOrigin = req.headers.origin || '';
  const normalizedOrigin = requestOrigin ? normalizeOrigin(requestOrigin) : '';

  // Check if origin is allowed FIRST (before setting headers)
  if (normalizedOrigin && !isOriginAllowed(normalizedOrigin)) {
    console.warn(`CORS blocked request from origin: ${requestOrigin}`);
    return res.status(403).json({ error: 'Not allowed by CORS' });
  }

  // Set CORS headers for allowed origins
  if (requestOrigin) {
    res.header('Access-Control-Allow-Origin', requestOrigin);
    res.header('Vary', 'Origin');
  }

  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');

  const requestedHeaders = req.headers['access-control-request-headers'];
  if (requestedHeaders) {
    res.header('Access-Control-Allow-Headers', requestedHeaders);
  } else {
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  }

  res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Type');

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
};

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:']
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

app.use(corsMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api', apiLimiter);

if (isDevelopment) {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

app.get('/health', async (_req, res) => {
  try {
    const dbHealth = await healthCheck();
    res.json({
      status: dbHealth.status === 'healthy' ? 'ok' : 'error',
      timestamp: Date.now(),
      environment: nodeEnv,
      database: dbHealth
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: Date.now(),
      environment: nodeEnv,
      database: { status: 'unhealthy', error: error.message }
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/messages', messagesRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, _req, res, _next) => {
  const message = isDevelopment ? err.message : 'Internal server error';
  const stack = isDevelopment ? err.stack : undefined;
  res.status(err.status || 500).json({ error: message, ...(stack && { stack }) });
});

io.on('connection', (socket) => {
  socket.on('authenticate', (token) => {
    try {
      const { userId, username } = verifyToken(token);
      socket.userId = userId;
      socket.username = username;
      socket.join(`user:${username}`);
      socket.emit('authenticated', { success: true });
    } catch {
      socket.emit('authenticated', { success: false, error: 'Invalid token' });
      socket.disconnect();
    }
  });

  socket.on('join-conversation', (conversationId) => {
    if (socket.username) socket.join(`conversation:${conversationId}`);
  });

  socket.on('leave-conversation', (conversationId) => {
    if (socket.username) socket.leave(`conversation:${conversationId}`);
  });
});

async function startServer() {
  try {
    await ensureDatabaseIntegrity();
    httpServer.listen(PORT, () => {
      console.log(`SecureDove running on port ${PORT} (${nodeEnv})`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// In serverless (Vercel) environments, the platform provides the HTTP server and calls the handler.
// Only start a standalone listener when not running on Vercel.
if (!process.env.VERCEL) {
  startServer();
}

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0));
});

export default app;
export { io, httpServer };
