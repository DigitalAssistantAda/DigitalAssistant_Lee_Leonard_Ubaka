import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

import Navigation from './components/Navigation';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Workspaces from './pages/Workspaces';
import WorkspaceDetail from './pages/WorkspaceDetail';
import WorkspaceSettings from './pages/WorkspaceSettings';
import WorkspaceIssues from './pages/WorkspaceIssues';
import Documents from './pages/Documents';
import Search from './pages/Search';
import Summaries from './pages/Summaries';
import AIAssistant from './pages/AIAssistant';
import UserSettings from './pages/UserSettings';
import Notifications from './pages/Notifications';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const getDefaultAccent = () => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    return value || '#8f2f5a';
  };

  const adjustHex = (hex, amount) => {
    const value = hex.replace('#', '');
    if (value.length !== 6) return hex;
    const num = parseInt(value, 16);
    const clamp = (channel) => Math.min(255, Math.max(0, channel));
    const r = clamp((num >> 16) + amount);
    const g = clamp(((num >> 8) & 0x00ff) + amount);
    const b = clamp((num & 0x0000ff) + amount);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  };

  const normalizeHex = (value) => {
    if (!value) return null;
    let hex = value.trim();
    if (!hex) return null;
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (hex.length === 4) {
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (hex.length !== 7) return null;
    return hex.toUpperCase();
  };

  const hexToRgb = (hex) => {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    const num = parseInt(normalized.slice(1), 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  };

  const rgbToHex = ({ r, g, b }) => {
    const clamp = (channel) => Math.min(255, Math.max(0, Math.round(channel)));
    return `#${((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1)}`.toUpperCase();
  };

  const srgbToLinear = (value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };

  const relativeLuminance = (hex) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const r = srgbToLinear(rgb.r);
    const g = srgbToLinear(rgb.g);
    const b = srgbToLinear(rgb.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const contrastRatio = (hexA, hexB) => {
    const lumA = relativeLuminance(hexA);
    const lumB = relativeLuminance(hexB);
    const lighter = Math.max(lumA, lumB);
    const darker = Math.min(lumA, lumB);
    return (lighter + 0.05) / (darker + 0.05);
  };

  const rgbToHsl = ({ r, g, b }) => {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
      if (max === rNorm) h = ((gNorm - bNorm) / delta) % 6;
      if (max === gNorm) h = (bNorm - rNorm) / delta + 2;
      if (max === bNorm) h = (rNorm - gNorm) / delta + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const l = (max + min) / 2;
    const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
    return { h, s, l };
  };

  const hslToRgb = ({ h, s, l }) => {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h >= 0 && h < 60) {
      r = c;
      g = x;
    } else if (h >= 60 && h < 120) {
      r = x;
      g = c;
    } else if (h >= 120 && h < 180) {
      g = c;
      b = x;
    } else if (h >= 180 && h < 240) {
      g = x;
      b = c;
    } else if (h >= 240 && h < 300) {
      r = x;
      b = c;
    } else {
      r = c;
      b = x;
    }
    return {
      r: (r + m) * 255,
      g: (g + m) * 255,
      b: (b + m) * 255,
    };
  };

  const adjustLightness = (hex, delta) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const hsl = rgbToHsl(rgb);
    const next = Math.min(1, Math.max(0, hsl.l + delta));
    return rgbToHex(hslToRgb({ ...hsl, l: next }));
  };

  const mixHex = (hexA, hexB, weight) => {
    const rgbA = hexToRgb(hexA);
    const rgbB = hexToRgb(hexB);
    if (!rgbA || !rgbB) return hexA;
    const mix = {
      r: rgbA.r * weight + rgbB.r * (1 - weight),
      g: rgbA.g * weight + rgbB.g * (1 - weight),
      b: rgbA.b * weight + rgbB.b * (1 - weight),
    };
    return rgbToHex(mix);
  };

  const pickTextColor = (hex) => {
    const white = '#FFFFFF';
    const nearBlack = '#101014';
    const whiteContrast = contrastRatio(hex, white);
    const blackContrast = contrastRatio(hex, nearBlack);
    return whiteContrast >= blackContrast ? white : nearBlack;
  };

  const ensureContrast = (hex, bgHex, minRatio) => {
    const base = normalizeHex(hex);
    const bg = normalizeHex(bgHex);
    if (!base || !bg) return hex;
    if (contrastRatio(base, bg) >= minRatio) return base;
    const bgIsLight = relativeLuminance(bg) > 0.5;
    const direction = bgIsLight ? -1 : 1;
    let candidate = base;
    for (let i = 0; i < 18; i += 1) {
      candidate = adjustLightness(candidate, direction * 0.05);
      if (contrastRatio(candidate, bg) >= minRatio) return candidate;
    }
    return candidate;
  };

  const getThemeBackgrounds = () => {
    const styles = getComputedStyle(document.documentElement);
    return {
      light: {
        bgPrimary: styles.getPropertyValue('--bg-primary-light').trim() || styles.getPropertyValue('--bg-primary').trim(),
        bgSecondary: styles.getPropertyValue('--bg-secondary-light').trim() || styles.getPropertyValue('--bg-secondary').trim(),
      },
      dark: {
        bgPrimary: styles.getPropertyValue('--bg-primary-dark').trim() || styles.getPropertyValue('--bg-primary').trim(),
        bgSecondary: styles.getPropertyValue('--bg-secondary-dark').trim() || styles.getPropertyValue('--bg-secondary').trim(),
      },
    };
  };

  const buildAccentSet = (hex, theme) => {
    const bgPrimary = theme.bgPrimary;
    const bgSecondary = theme.bgSecondary;
    const lumPrimary = relativeLuminance(bgPrimary);
    const lumSecondary = relativeLuminance(bgSecondary);
    const targetBg = lumPrimary >= lumSecondary ? bgPrimary : bgSecondary;
    const minRatio = 4.5;
    const accent = ensureContrast(hex, targetBg, minRatio);
    const hover = adjustHex(accent, -18);
    const secondary = adjustLightness(accent, lumPrimary > 0.5 ? 0.14 : -0.14);
    const highlight = mixHex(accent, targetBg, lumPrimary > 0.5 ? 0.14 : 0.22);
    const contrast = pickTextColor(accent);
    return { accent, hover, secondary, highlight, contrast };
  };

  const applyAccentColor = (color) => {
    const root = document.documentElement;
    const nextColor = normalizeHex(color || getDefaultAccent());
    const customVars = [
      '--accent-primary-custom',
      '--accent-hover-custom',
      '--accent-secondary-custom',
      '--accent-highlight-custom',
      '--accent-contrast-custom',
      '--accent-primary-custom-dark',
      '--accent-hover-custom-dark',
      '--accent-secondary-custom-dark',
      '--accent-highlight-custom-dark',
      '--accent-contrast-custom-dark',
    ];

    if (!nextColor) {
      customVars.forEach((key) => root.style.removeProperty(key));
      return;
    }

    const themes = getThemeBackgrounds();
    const lightSet = buildAccentSet(nextColor, themes.light);
    const darkSet = buildAccentSet(nextColor, themes.dark);

    root.style.setProperty('--accent-primary-custom', lightSet.accent);
    root.style.setProperty('--accent-hover-custom', lightSet.hover);
    root.style.setProperty('--accent-secondary-custom', lightSet.secondary);
    root.style.setProperty('--accent-highlight-custom', lightSet.highlight);
    root.style.setProperty('--accent-contrast-custom', lightSet.contrast);

    root.style.setProperty('--accent-primary-custom-dark', darkSet.accent);
    root.style.setProperty('--accent-hover-custom-dark', darkSet.hover);
    root.style.setProperty('--accent-secondary-custom-dark', darkSet.secondary);
    root.style.setProperty('--accent-highlight-custom-dark', darkSet.highlight);
    root.style.setProperty('--accent-contrast-custom-dark', darkSet.contrast);
  };

  useEffect(() => {
    // Fetch current user from /me endpoint
    const fetchCurrentUser = async () => {
      const token = localStorage.getItem('token');
      
      if (token) {
        try {
          const response = await fetch(`${API_URL}/api/v1/auth/me`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            const userData = await response.json();
            setUser(userData.user);
            localStorage.setItem('user', JSON.stringify(userData.user));
          } else {
            // Token invalid, clear it
            localStorage.removeItem('token');
            localStorage.removeItem('user');
          }
        } catch (err) {
          console.error('Error fetching user:', err);
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      
      setLoading(false);
    };
    
    fetchCurrentUser();
  }, [API_URL]);

  useEffect(() => {
    const fetchPreferences = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const response = await fetch(`${API_URL}/api/v1/users/preferences`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          applyAccentColor(data.accent_color || null);
        }
      } catch (err) {
        console.error('Error fetching preferences:', err);
      }
    };

    if (user) {
      fetchPreferences();
    } else {
      applyAccentColor(null);
    }
  }, [user, API_URL]);

  const handleLogin = (data) => {
    setUser(data.user);
  };

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        // Call backend logout endpoint
        await fetch('http://localhost:8000/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      // Clear local storage regardless of API call success
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    }
  };

  if (loading) {
    return <div className="app-loading">Loading...</div>;
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
            element={user ? <Documents /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/documents/:containerId" 
            element={user ? <Documents /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/documents/:containerId/:documentId" 
            element={user ? <Documents /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/search" 
            element={user ? <Search /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/summaries" 
            element={user ? <Summaries /> : <Navigate to="/login" />} 
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
        </Routes>
        
      </div>
    </Router>
  );
}

export default App;
