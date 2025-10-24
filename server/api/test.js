module.exports = (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Check environment variables
  const envCheck = {
    NODE_ENV: process.env.NODE_ENV,
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL ? 'SET (starts with libsql://)' : 'NOT SET',
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN ? 'SET (JWT token)' : 'NOT SET',
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    VERCEL: process.env.VERCEL ? 'true' : 'false',
    timestamp: Date.now()
  };

  res.status(200).json(envCheck);
};