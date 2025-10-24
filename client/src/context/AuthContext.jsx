import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../utils/api';
import {
  generateKeyPair,
  generateSalt,
  exportPublicKey,
  derivePasswordKey,
  encryptPrivateKey,
  decryptPrivateKey
} from '../utils/crypto';
import { savePrivateKey, getPrivateKey, clearPrivateKey } from '../utils/keyStore';

const AuthContext = createContext(null);

const persistedSession = () => {
  const token = localStorage.getItem('token');
  const stored = localStorage.getItem('sessionData');
  if (!token || !stored) return null;
  try {
    return { ...JSON.parse(stored), token, privateKey: null };
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('sessionData');
    return null;
  }
};

const serialiseSession = ({ token, ...rest }) => {
  localStorage.setItem('token', token);
  localStorage.setItem('sessionData', JSON.stringify(rest));
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentSession, setCurrentSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const init = async () => {
      const base = persistedSession();
      if (!base) {
        setLoading(false);
        return;
      }
      const storedKey = await getPrivateKey(base.username);
      setCurrentSession({ ...base, privateKey: storedKey || null });
      setLoading(false);
    };
    init();
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('sessionData');
    setCurrentSession(null);
  }, []);

  const persistAndSet = async (session) => {
    const { privateKey, token } = session;
    const base = {
      userId: session.userId,
      username: session.username,
      publicKey: session.publicKey,
      salt: session.salt,
      encrypted_private_key: session.encrypted_private_key,
      loginTime: session.loginTime
    };
    serialiseSession({ ...base, token });
    setCurrentSession({ ...base, token, privateKey });
    if (privateKey) await savePrivateKey(session.username, privateKey);
  };

  const register = async (username, password) => {
    setError(null);
    setLoading(true);
    try {
      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        throw new Error('Username must be 3-20 characters (letters, numbers, _ or -)');
      }
      const { exists } = await authAPI.checkUsername(username);
      if (exists) throw new Error('Username already exists');

      const salt = generateSalt();
      const passwordKey = await derivePasswordKey(password, salt);
      const keyPair = await generateKeyPair();
      const publicKey = await exportPublicKey(keyPair.publicKey);
      const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, passwordKey);

      const { user, token } = await authAPI.register({
        username,
        password,
        public_key: publicKey,
        salt,
        encrypted_private_key: encryptedPrivateKey
      });

      await persistAndSet({
        userId: user.id,
        username: user.username,
        publicKey: user.public_key,
        salt: user.salt,
        encrypted_private_key: user.encrypted_private_key,
        privateKey: keyPair.privateKey,
        token,
        loginTime: Date.now()
      });
      return { success: true };
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    setError(null);
    setLoading(true);
    try {
      const { user, token } = await authAPI.login({ username, password });
      const passwordKey = await derivePasswordKey(password, user.salt);
      const privateKey = await decryptPrivateKey(user.encrypted_private_key, passwordKey);

      await persistAndSet({
        userId: user.id,
        username: user.username,
        publicKey: user.public_key,
        salt: user.salt,
        encrypted_private_key: user.encrypted_private_key,
        privateKey,
        token,
        loginTime: Date.now()
      });
      return { success: true };
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = useCallback(async () => {
    try {
      await authAPI.logout();
    } catch {
      /* ignore network errors on logout */
    } finally {
      if (currentSession?.username) await clearPrivateKey(currentSession.username);
      clearSession();
    }
  }, [clearSession]);

  useEffect(() => {
    if (!currentSession) return undefined;
    let timer = setTimeout(logout, 30 * 60 * 1000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(logout, 30 * 60 * 1000);
    };
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
    };
  }, [currentSession, logout]);

  const checkUsernameExists = async (username) => {
    try {
      const { available } = await authAPI.checkUsername(username);
      return !available;
    } catch {
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentSession,
        loading,
        error,
        register,
        login,
        logout,
        checkUsernameExists,
        isAuthenticated: Boolean(currentSession)
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
