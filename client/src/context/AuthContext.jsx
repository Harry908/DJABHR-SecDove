// Phase 3.1: Authentication Flow with E2EE
import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI, contactsAPI } from '../utils/api';
import {
  generateKeyPair,
  generateSalt,
  exportPublicKey,
  exportPrivateKey,
  derivePasswordKey,
  encryptPrivateKey,
  decryptPrivateKey
} from '../utils/crypto';

console.log('🔐 AuthContext: Module loaded');

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  console.log('🔐 AuthProvider: Initializing...');
  const [currentSession, setCurrentSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Initialize session from localStorage on mount
  useEffect(() => {
    console.log('🔐 AuthProvider: Checking for existing session...');
    const initSession = async () => {
      const token = localStorage.getItem('token');
      const sessionData = localStorage.getItem('sessionData');
      
      if (token && sessionData) {
        try {
          const parsed = JSON.parse(sessionData);
          
          // Security check: privateKey must exist in memory for session to be valid
          // Since privateKey is never stored in localStorage (security best practice),
          // it will always be undefined after page reload.
          // This forces re-login, which is the secure behavior for E2EE apps.
          if (!parsed.privateKey) {
            console.log('🔐 AuthProvider: No privateKey in memory, clearing session (requires re-login)');
            clearSession();
          } else {
            setCurrentSession(parsed);
          }
        } catch (err) {
          console.error('Session init error:', err);
          clearSession();
        }
      }
      setLoading(false);
    };
    
    initSession();
  }, []);

  // Session timeout (30 minutes inactivity)
  useEffect(() => {
    if (!currentSession) return;

    let timeout;
    const resetTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        logout();
      }, 30 * 60 * 1000); // 30 minutes
    };

    const activity = () => resetTimeout();
    window.addEventListener('mousemove', activity);
    window.addEventListener('keydown', activity);
    resetTimeout();

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('mousemove', activity);
      window.removeEventListener('keydown', activity);
    };
  }, [currentSession]);

  const clearSession = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('sessionData');
    setCurrentSession(null);
  };

  // Phase 3.1: Registration with key generation
  const register = async (username, password) => {
    setError(null);
    setLoading(true);

    try {
      // 1. Validate username format
      if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
        throw new Error('Username must be 3-20 characters (letters, numbers, _ or -)');
      }

      // 2. Check if username exists
      const checkResult = await authAPI.checkUsername(username);
      if (checkResult.exists) {
        throw new Error('Username already exists');
      }

      // 3. Generate salt
      const salt = generateSalt();

      // 4. Derive password key
      const passwordKey = await derivePasswordKey(password, salt);

      // 5. Generate RSA key pair
      const keyPair = await generateKeyPair();

      // 6. Export and encrypt private key
      const encryptedPrivateKey = await encryptPrivateKey(keyPair.privateKey, passwordKey);

      // 7. Export public key
      const publicKey = await exportPublicKey(keyPair.publicKey);

      // 8. Register with server
      const response = await authAPI.register({
        username,
        password,
        public_key: publicKey,
        salt,
        encrypted_private_key: encryptedPrivateKey
      });

      // 9. Store token and session
      localStorage.setItem('token', response.token);
      
      const session = {
        userId: response.user.id,
        username: response.user.username,
        publicKey: response.user.public_key,
        salt: response.user.salt,
        encrypted_private_key: response.user.encrypted_private_key,
        privateKey: null, // Will be set after login
        loginTime: Date.now()
      };

      // Decrypt and store private key in memory
      session.privateKey = keyPair.privateKey;
      
      localStorage.setItem('sessionData', JSON.stringify({
        userId: session.userId,
        username: session.username,
        publicKey: session.publicKey,
        salt: session.salt,
        encrypted_private_key: session.encrypted_private_key,
        loginTime: session.loginTime
      }));

      setCurrentSession(session);
      setLoading(false);
      return { success: true };
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
      throw err;
    }
  };

  // Phase 3.1: Login with private key decryption
  const login = async (username, password) => {
    setError(null);
    setLoading(true);

    try {
      // 1. Login to get user data
      const response = await authAPI.login({ username, password });

      // 2. Store token
      localStorage.setItem('token', response.token);

      // 3. Derive password key
      const passwordKey = await derivePasswordKey(password, response.user.salt);

      // 4. Decrypt private key
      const privateKey = await decryptPrivateKey(response.user.encrypted_private_key, passwordKey);

      // 5. Create session
      const session = {
        userId: response.user.id,
        username: response.user.username,
        publicKey: response.user.public_key,
        salt: response.user.salt,
        encrypted_private_key: response.user.encrypted_private_key,
        privateKey: privateKey, // Store in memory only
        loginTime: Date.now()
      };

      // Store non-sensitive data
      localStorage.setItem('sessionData', JSON.stringify({
        userId: session.userId,
        username: session.username,
        publicKey: session.publicKey,
        salt: session.salt,
        encrypted_private_key: session.encrypted_private_key,
        loginTime: session.loginTime
      }));

      setCurrentSession(session);
      setLoading(false);
      return { success: true };
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setLoading(false);
      throw err;
    }
  };

  // Phase 3.1: Logout
  const logout = async () => {
    try {
      await authAPI.logout();
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      clearSession();
    }
  };

  // Check if username exists
  const checkUsernameExists = async (username) => {
    try {
      const result = await authAPI.checkUsername(username);
      return result.exists;
    } catch (err) {
      console.error('Username check error:', err);
      // If there's an error, assume username doesn't exist to allow registration
      return false;
    }
  };

  const value = {
    currentSession,
    loading,
    error,
    register,
    login,
    logout,
    checkUsernameExists,
    isAuthenticated: !!currentSession
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
