import fs from 'fs';
import { dirname, join } from 'path';

// Resolve .env path without using import.meta.url so this file works when
// compiled to CommonJS by some build environments.
const possibleRoots = [
  process.cwd(),
  // If code is executed from repo root, server folder may be under ./server
  join(process.cwd(), 'server')
];

let envPath = null;
for (const root of possibleRoots) {
  const candidate = join(root, '.env');
  if (fs.existsSync(candidate)) {
    envPath = candidate;
    break;
  }
}

// Fallback to server/.env relative to current working directory
if (!envPath) envPath = join(process.cwd(), 'server', '.env');

const loadEnv = () => {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && !Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
};

loadEnv();

export const getEnv = (key, fallback) => {
  const value = process.env[key];
  return value !== undefined ? value : fallback;
};

