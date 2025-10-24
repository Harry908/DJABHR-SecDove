// Compatibility wrapper so Vercel (when building from repo root)
// can find the serverless function placed under `server/api/`.
// This file simply re-exports the actual implementation.
module.exports = require('../server/api/health.js');
