import React, { useState, useEffect, useLayoutEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

import Navigation from './components/Navigation';
import PetalSpinner from './components/PetalSpinner';
import { apiFetch } from './utils/apiClient';
import { applyAccentColor, normalizeHexColor, USER_ACCENT_STORAGE_KEY } from './utils/accentAccessibility';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Workspaces from './pages/Workspaces';
import WorkspaceDetail from './pages/WorkspaceDetail';
import WorkspaceSettings from './pages/WorkspaceSettings';
import WorkspaceIssues from './pages/WorkspaceIssues';
import Documents from './pages/Documents';
import Search from './pages/Search';
import AIAssistant from './pages/AIAssistant';
import UserSettings from './pages/UserSettings';
import Notifications from './pages/Notifications';
import NotFound from './pages/NotFound';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const seedAccentCache = (accentColor) => {
    try {
      const normalized = normalizeHexColor(accentColor);
      if (!normalized) return;
      localStorage.setItem('ada:accent-color', normalized);
      localStorage.setItem('accent_color', normalized);
    } catch (_) {}
  };

  const syncUserAccent = (accentColor) => {
    try {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return;
      const parsed = JSON.parse(rawUser);
      if (!parsed || typeof parsed !== 'object') return;
      parsed.accent_color = normalizeHexColor(accentColor) || null;
      localStorage.setItem('user', JSON.stringify(parsed));
    } catch (_) {}
  };

  useLayoutEffect(() => {
    if (localStorage.getItem('darkMode') === 'true') {
      document.documentElement.classList.add('dark');
    }
    const cachedAccent = normalizeHexColor(localStorage.getItem(USER_ACCENT_STORAGE_KEY))
      || normalizeHexColor(localStorage.getItem('ada:accent-color'));
    applyAccentColor(cachedAccent);
  }, []);

  useEffect(() => {
    // "Remember Me" gate: if the user did not check "remember me" and this
    // is a fresh browser session (sessionStorage is empty), clear the stored
    // auth so they are required to log in again.
    const shouldPersist =
      localStorage.getItem('persist_session') === 'true' ||
      sessionStorage.getItem('session_active') === 'true';

    if (!shouldPersist && localStorage.getItem('token')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('persist_session');
    }

    const fetchCurrentUser = async () => {
      const token = localStorage.getItem('token');

      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const userData = await apiFetch('/api/v1/auth/me');
        if (userData?.user) {
          setUser(userData.user);
          localStorage.setItem('user', JSON.stringify(userData.user));
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      } catch (err) {
        console.error('Error fetching user:', err);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      } finally {
        setLoading(false);
      }
    };

    fetchCurrentUser();
  }, []);

  useEffect(() => {
    if (loading) {
      return;
    }

    const fetchPreferences = async () => {
      try {
        const data = await apiFetch('/api/v1/users/preferences');
        const normalizedAccent = normalizeHexColor(data?.accent_color);
        syncUserAccent(normalizedAccent);
        seedAccentCache(normalizedAccent);
        if (normalizedAccent) {
          localStorage.setItem(USER_ACCENT_STORAGE_KEY, normalizedAccent);
        } else {
          localStorage.removeItem(USER_ACCENT_STORAGE_KEY);
        }
        applyAccentColor(normalizedAccent);
      } catch (err) {
        console.error('Error fetching preferences:', err);
      }
    };

    // Avoid clearing cached/pre-applied accent during initial auth bootstrap,
    // otherwise a refresh can briefly flash back to default colors.
    if (loading) return;

    if (user) {
      fetchPreferences();
    } else {
      localStorage.removeItem(USER_ACCENT_STORAGE_KEY);
      applyAccentColor(null);
    }
  }, [user, loading]);

  // Real-time: WebSocket for server-push (notifications, workspaces). Not used by Chat with Ada (chat uses REST only).
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const base = (API_URL || '').replace(/^https?/, (s) => (s === 'https' ? 'wss' : 'ws')).replace(/\/+$/, '');
    const wsUrl = `${base}/api/v1/ws?token=${encodeURIComponent(token)}`;
    let ws = null;
    let reconnectTimeout = null;
    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg?.type === 'notifications.changed') {
              window.dispatchEvent(new Event('notifications-updated'));
            }
            if (msg?.type === 'workspaces.changed') {
              window.dispatchEvent(new CustomEvent('workspaces-updated', { detail: msg?.payload || {} }));
            }
            if (msg?.type === 'containers.changed') {
              window.dispatchEvent(new CustomEvent('containers-updated', { detail: msg?.payload || {} }));
            }
            if (msg?.type === 'documents.changed') {
              window.dispatchEvent(new CustomEvent('documents-updated', { detail: msg?.payload || {} }));
            }
          } catch (_) {}
        };
        ws.onclose = () => {
          ws = null;
          reconnectTimeout = window.setTimeout(connect, 5000);
        };
        ws.onerror = () => {};
      } catch (_) {}
    };
    connect();
    return () => {
      if (reconnectTimeout) window.clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [user, API_URL]);

  useEffect(() => {
    const root = document.documentElement;
    const easterClass = 'easter-script';
    const storageKey = 'ada:easter-script-enabled';
    const sequence = ['a', 'd', 'a'];
    let buffer = [];
    let resetTimer = null;

    if (localStorage.getItem(storageKey) === '1') {
      root.classList.add(easterClass);
    }

    const onKeyDown = (event) => {
      const target = event.target;
      const isTypingField = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      if (isTypingField) return;

      const key = String(event.key || '').toLowerCase();
      if (!key || key.length !== 1) return;

      buffer.push(key);
      if (buffer.length > sequence.length) {
        buffer = buffer.slice(-sequence.length);
      }

      if (resetTimer) {
        clearTimeout(resetTimer);
      }
      resetTimer = setTimeout(() => {
        buffer = [];
      }, 1400);

      const matched = sequence.every((char, idx) => buffer[idx] === char);
      if (!matched) return;

      const nextEnabled = !root.classList.contains(easterClass);
      root.classList.toggle(easterClass, nextEnabled);
      localStorage.setItem(storageKey, nextEnabled ? '1' : '0');
      buffer = [];
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (resetTimer) {
        clearTimeout(resetTimer);
      }
    };
  }, []);

  const handleLogin = (data) => {
    setUser(data.user);
  };

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        await apiFetch('/api/v1/auth/logout', {
          method: 'POST',
        });
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('persist_session');
      sessionStorage.removeItem('session_active');
      setUser(null);
    }
  };

  if (loading) {
    return <PetalSpinner page label="Ada is waking up…" />;
  }

  return (
    <Router>
      <div className="App">
        <Navigation user={user} onLogout={handleLogout} />
        
        <Routes>
          <Route 
            path="/" 
            element={user ? <Navigate to="/dashboard" /> : <Landing />} 
          />
          <Route 
            path="/login" 
            element={user ? <Navigate to="/dashboard" /> : <Login onLogin={handleLogin} />} 
          />
          <Route 
            path="/dashboard" 
            element={user ? <Dashboard /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace" 
            element={user ? <Workspaces /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace/:id" 
            element={user ? <WorkspaceDetail /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace/:id/settings" 
            element={user ? <WorkspaceSettings onClose={() => window.history.back()} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace/:id/issues" 
            element={user ? <WorkspaceIssues currentUser={user} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/documents" 
            element={user ? <Documents currentUser={user} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/documents/:containerId" 
            element={user ? <Documents currentUser={user} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/documents/:containerId/:documentId" 
            element={user ? <Documents currentUser={user} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/search" 
            element={user ? <Search /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/summaries" 
            element={user ? <Navigate to="/ai-assistant" replace /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/ai-assistant" 
            element={user ? <AIAssistant /> : <Navigate to="/login" />} 
          />
          <Route
            path="/settings"
            element={user ? <UserSettings /> : <Navigate to="/login" />}
          />
          <Route 
            path="/notifications" 
            element={user ? <Notifications /> : <Navigate to="/login" />} 
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
        
      </div>
    </Router>
  );
}

export default App;
