import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const WebSocketContext = createContext(null);
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:8000';
const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH || '/socket.io';

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) throw new Error('useWebSocket must be used within WebSocketProvider');
  return context;
};

export const WebSocketProvider = ({ children }) => {
  const { currentSession } = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!currentSession?.token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      transports: ['polling'], // Force polling transport for Vercel compatibility
      upgrade: false, // Disable WebSocket upgrade attempts
      rememberUpgrade: false, // Don't remember upgrade capability
      timeout: 20000 // Increase timeout for polling
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('authenticate', currentSession.token);
    });

    socket.on('authenticated', (data) => {
      if (!data.success) socket.disconnect();
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      setConnected(false);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentSession?.token]);

  const on = (event, handler) => {
    socketRef.current?.on(event, handler);
  };

  const off = (event, handler) => {
    socketRef.current?.off(event, handler);
  };

  const emit = (event, data) => {
    socketRef.current?.emit(event, data);
  };

  const joinConversation = (conversationId) => {
    if (connected) emit('join-conversation', conversationId);
  };

  const leaveConversation = (conversationId) => {
    if (connected) emit('leave-conversation', conversationId);
  };

  return (
    <WebSocketContext.Provider
      value={{ connected, socket: socketRef.current, on, off, emit, joinConversation, leaveConversation }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
