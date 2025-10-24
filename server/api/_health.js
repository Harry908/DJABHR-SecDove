const DEFAULT_ORIGIN = 'https://secdove-frontend.vercel.app';

// Parse allowed origins from environment variable or use default
const getAllowedOrigins = () => {
  const corsOrigin = process.env.CORS_ORIGIN || DEFAULT_ORIGIN;
  return corsOrigin.split(',').map(o => o.trim().toLowerCase()).filter(Boolean);
};

const allowedOrigins = getAllowedOrigins();

function applyCors(req, res) {
  const requestOrigin = req.headers.origin || '';
  const normalizedOrigin = requestOrigin.toLowerCase().replace(/\/$/, '');

  // Check if origin is allowed
  const isAllowed = !requestOrigin || allowedOrigins.includes(normalizedOrigin) || allowedOrigins.includes('*');

  if (!isAllowed) {
    // Don't set CORS headers for disallowed origins
    return false;
  }

  // Set CORS headers only for allowed origins
  if (requestOrigin) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  const requested = req.headers['access-control-request-headers'];
  res.setHeader('Access-Control-Allow-Headers', requested || 'Content-Type, Authorization, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
  return true;
}

export default (req, res) => {
  const corsAllowed = applyCors(req, res);

  if (!corsAllowed) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not allowed by CORS' }));
    return;
  }

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
};
