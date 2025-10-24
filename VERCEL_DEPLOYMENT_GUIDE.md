# Vercel Deployment Guide - Complete Setup

## 🎯 Project Structure Overview

```
SecureDove/
├── client/                    ← Frontend (Deploy as separate Vercel project)
│   ├── src/
│   ├── .env                   ← Development config
│   ├── .env.development       ← Auto-loaded in dev
│   ├── .env.production        ← Production config template
│   ├── .env.example           ← Documentation
│   ├── package.json
│   └── vite.config.js
│
└── server/                    ← Backend (Deploy as separate Vercel project)
    ├── api/                   ← Vercel serverless functions (CRITICAL!)
    │   ├── index.js           ← Main API handler
    │   ├── socketio.js        ← WebSocket handler
    │   └── _health.js         ← Health check
    ├── routes/                ← Express routes
    ├── config/
    ├── middleware/
    ├── utils/
    ├── .env                   ← Development config (DO NOT COMMIT)
    ├── .env.example           ← Documentation
    ├── .env.production        ← Production template
    ├── server.js              ← Main Express app
    ├── vercel.json            ← Vercel configuration (CRITICAL!)
    └── package.json
```

## ⚠️ Critical Understanding

You are deploying **TWO SEPARATE Vercel projects**:
1. **Frontend project** with root directory = `client/`
2. **Backend project** with root directory = `server/`

The `api/` folder and `vercel.json` **MUST** be inside `server/` directory (they have been moved there).

---

## 📋 Pre-Deployment Checklist

### ✅ Backend Requirements
- [ ] `server/api/` folder exists with all 3 files
- [ ] `server/vercel.json` exists
- [ ] All CORS fixes applied (from CORS_FIX_SUMMARY.md)
- [ ] Environment variables ready

### ✅ Frontend Requirements
- [ ] `client/.env.production` configured
- [ ] API URLs point to backend

---

## 🚀 Step-by-Step Deployment

### Step 1: Deploy Backend First

#### 1.1 Create Backend Vercel Project

1. Go to [Vercel Dashboard](https://vercel.com/new)
2. Import your Git repository
3. **CRITICAL:** Set **Root Directory** to `server`
4. Project name: `secdove-backend` (or your preference)

#### 1.2 Configure Build Settings

- **Framework Preset:** Other
- **Build Command:** `npm run build`
- **Output Directory:** (leave empty - not needed for Node.js)
- **Install Command:** `npm install`

#### 1.3 Set Environment Variables

Go to **Settings → Environment Variables** and add:

```env
NODE_ENV=production
JWT_SECRET=<generate-strong-random-32-char-secret>
TURSO_DATABASE_URL=<your-turso-database-url>
TURSO_AUTH_TOKEN=<your-turso-auth-token>
CORS_ORIGIN=https://secdove-frontend.vercel.app
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX_REQUESTS=5
```

**Generate strong JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Setup Turso Database:**
1. Install Turso CLI: `npm install -g @tursodatabase/turso-cli`
2. Login: `turso auth login`
3. Create database: `turso db create securedove`
4. Get database URL: `turso db show securedove`
5. Create auth token: `turso db tokens create securedove`

⚠️ **IMPORTANT:**
- `CORS_ORIGIN` should match your frontend URL EXACTLY (update after frontend is deployed)
- For now, use the default or your expected frontend URL
- **Turso provides persistent storage** - your data will survive redeployments

#### 1.4 Deploy Backend

1. Click **Deploy**
2. Wait for deployment to complete
3. **Note your backend URL:** `https://secdove-backend.vercel.app` (or your custom URL)
4. Test health endpoint: `https://secdove-backend.vercel.app/health`

Expected response:
```json
{"status":"ok","timestamp":1234567890,"environment":"production"}
```

---

### Step 2: Deploy Frontend

#### 2.1 Create Frontend Vercel Project

1. Go to [Vercel Dashboard](https://vercel.com/new)
2. Import the **SAME Git repository**
3. **CRITICAL:** Set **Root Directory** to `client`
4. Project name: `secdove-frontend` (or your preference)

#### 2.2 Configure Build Settings

- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

#### 2.3 Set Environment Variables

Go to **Settings → Environment Variables** and add:

```env
VITE_API_URL=https://secdove-backend.vercel.app/api
VITE_SOCKET_URL=https://secdove-backend.vercel.app
```

Replace `secdove-backend.vercel.app` with your actual backend URL from Step 1.

#### 2.4 Deploy Frontend

1. Click **Deploy**
2. Wait for deployment to complete
3. **Note your frontend URL:** `https://secdove-frontend.vercel.app` (or your custom URL)

---

### Step 3: Update Backend CORS Configuration

Now that you have the frontend URL, update the backend:

1. Go to **Backend project** → Settings → Environment Variables
2. Find `CORS_ORIGIN` and click **Edit**
3. Update to your actual frontend URL: `https://secdove-frontend.vercel.app`
4. **Save**
5. **CRITICAL:** Go to Deployments → Latest → Click "..." → **Redeploy**

⚠️ Environment variables don't apply until you redeploy!

---

### Step 4: Verify Deployment

#### 4.1 Test Backend Health
```bash
curl https://secdove-backend.vercel.app/health
```

Expected:
```json
{"status":"ok","timestamp":...,"environment":"production"}
```

#### 4.2 Test CORS

1. Open frontend: `https://secdove-frontend.vercel.app`
2. Open Browser DevTools → Network tab
3. Try to register a new account
4. **Check for CORS errors** - should be NONE!
5. Verify response headers include:
   ```
   Access-Control-Allow-Origin: https://secdove-frontend.vercel.app
   Access-Control-Allow-Credentials: true
   ```

#### 4.3 Test Full Flow

1. ✅ Register new account
2. ✅ Login
3. ✅ Add contacts
4. ✅ Create conversation
5. ✅ Send messages
6. ✅ Real-time message delivery (WebSocket)

---

## 🔧 Local Development

### Start Backend (Terminal 1)
```bash
cd server
npm install
npm run dev
# Runs on http://localhost:8000
```

### Start Frontend (Terminal 2)
```bash
cd client
npm install
npm run dev
# Runs on http://localhost:5173
```

Frontend will automatically connect to backend at `http://localhost:8000` (configured in `client/.env`).

---

## 🐛 Troubleshooting

### Issue: CORS Errors in Production

**Symptom:**
```
Access to fetch at 'https://secdove-backend.vercel.app/api/...'
from origin 'https://secdove-frontend.vercel.app' has been blocked by CORS
```

**Solution:**
1. Check backend environment variable `CORS_ORIGIN` matches frontend URL EXACTLY
2. No trailing slash: ✅ `https://secdove-frontend.vercel.app` ❌ `https://secdove-frontend.vercel.app/`
3. Check case sensitivity: URLs are case-sensitive
4. **Redeploy backend** after changing environment variables

**Debug:**
```bash
# Check backend logs
vercel logs [deployment-url]

# Look for:
"CORS blocked request from origin: https://..."
```

---

### Issue: 404 on API Routes

**Symptom:**
```
GET https://secdove-backend.vercel.app/api/auth/login → 404
```

**Possible causes:**
1. `vercel.json` not in `server/` directory
2. `api/` folder not in `server/` directory
3. Vercel root directory not set to `server`

**Solution:**
1. Verify file structure:
   ```bash
   server/
   ├── api/
   │   ├── index.js
   │   ├── socketio.js
   │   └── _health.js
   └── vercel.json
   ```
2. Check Vercel project settings → Root Directory = `server`
3. Redeploy

---

### Issue: WebSocket Connection Failed

**Symptom:**
```
WebSocket connection to 'wss://secdove-backend.vercel.app/socket.io/...' failed
```

**Cause:** WebSockets require **Vercel Pro or Enterprise** plan.

**Solution:**
1. Upgrade to Vercel Pro
2. OR remove real-time features (fallback to polling)

**Test WebSocket support:**
```javascript
// In browser console on frontend
const socket = io('https://secdove-backend.vercel.app');
socket.on('connect', () => console.log('Connected!'));
```

---

### Issue: "Server unavailable" Error

**Symptom:**
```json
{"error":"Server unavailable","hint":"Ensure TURSO_DATABASE_URL is configured..."}
```

**Cause:** Turso database environment variables not set.

**Solution:**
1. Go to backend Settings → Environment Variables
2. Add: `TURSO_DATABASE_URL=<your-turso-url>`
3. Add: `TURSO_AUTH_TOKEN=<your-turso-token>`
4. **Redeploy backend**

⚠️ **Note:** Make sure your Turso database is created and accessible. Test locally first with the same environment variables.

---

### Issue: Environment Variables Not Working

**Symptom:** Using old/default values instead of Vercel environment variables

**Solution:**
1. Environment variables only apply to NEW deployments
2. After adding/changing variables: **REDEPLOY**
3. Go to Deployments → Latest → "..." → Redeploy

---

## 📊 Monitoring & Logs

### View Backend Logs
1. Go to backend project in Vercel
2. Deployments → [Latest deployment] → Function Logs
3. Check for errors:
   - CORS warnings
   - Database errors
   - Authentication failures

### View Frontend Logs
1. Open browser DevTools → Console
2. Check for:
   - Network errors
   - CORS errors
   - WebSocket connection issues

---

## 🔒 Security Checklist

Before going live:

- [ ] Strong `JWT_SECRET` set (32+ random characters)
- [ ] `CORS_ORIGIN` set to exact frontend URL (no wildcards)
- [ ] HTTPS enabled (Vercel provides this automatically)
- [ ] Rate limiting configured
- [ ] No secrets in client-side code
- [ ] `.env` files in `.gitignore` (verified)
- [ ] Database backup strategy (if using persistent DB)

---

## 🔄 Redeployment After Code Changes

### Backend Changes
```bash
git add .
git commit -m "Backend updates"
git push
# Vercel auto-deploys
```

### Frontend Changes
```bash
git add .
git commit -m "Frontend updates"
git push
# Vercel auto-deploys
```

### Environment Variable Changes
1. Update in Vercel dashboard
2. **Manually trigger redeploy** (variables don't auto-apply)

---

## 📚 Related Documentation

- [CORS_FIX_SUMMARY.md](CORS_FIX_SUMMARY.md) - CORS security fixes
- [DEPLOYMENT.md](DEPLOYMENT.md) - General deployment info
- [INTEGRATION_CHECKLIST.md](INTEGRATION_CHECKLIST.md) - Integration checklist
- `server/SERVER_ENV_SETUP.md` - Server environment details
- `client/FRONTEND_ENV_SETUP.md` - Frontend environment details

---

## ✅ Deployment Complete!

Your SecureDove app should now be live at:
- **Frontend:** `https://secdove-frontend.vercel.app`
- **Backend:** `https://secdove-backend.vercel.app`

Test the full registration → login → messaging flow to confirm everything works!
