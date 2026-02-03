import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, Settings, Moon, Sun, LogOut, Search, Sparkles } from 'lucide-react';

function Navigation({ user, onLogout }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const location = useLocation();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    // Check for saved dark mode preference
    const savedMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(savedMode);
    if (savedMode) {
      document.documentElement.classList.add('dark');
    }
  }, []);

  const toggleDarkMode = () => {
    const newMode = !darkMode;
    setDarkMode(newMode);
    localStorage.setItem('darkMode', newMode);
    if (newMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const isActive = (path) => location.pathname === path;

  const navStyle = {
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border-color)',
    padding: '1rem 2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    backdropFilter: 'blur(10px)',
    transition: 'all 0.3s ease'
  };

  const navLeftStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '2.5rem'
  };

  const logoStyle = {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
    textDecoration: 'none',
    letterSpacing: '-0.02em'
  };

  const navLinksStyle = {
    display: 'flex',
    gap: '2rem',
    listStyle: 'none',
    margin: 0,
    padding: 0
  };

  const linkStyle = (active) => ({
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    textDecoration: 'none',
    fontSize: '0.95rem',
    fontWeight: 500,
    transition: 'all 0.2s ease',
    position: 'relative',
    paddingBottom: '1.15rem',
    borderBottom: active ? '2px solid var(--accent-secondary)' : 'none'
  });

  const navRightStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem'
  };

  const searchBoxStyle = {
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    borderRadius: '0',
    padding: '0.5rem 1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    width: '300px'
  };

  const searchInputStyle = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    fontSize: '0.9rem',
    outline: 'none',
    width: '100%',
    fontFamily: 'Outfit, sans-serif'
  };

  const iconBtnStyle = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '0.5rem',
    borderRadius: '0',
    transition: 'all 0.2s ease',
    fontSize: '1rem'
  };

  const userBadgeStyle = {
    background: 'var(--accent-primary)',
    color: 'white',
    padding: '0.4rem 1rem',
    borderRadius: '0',
    fontSize: '0.85rem',
    fontWeight: 600,
    fontFamily: 'JetBrains Mono, monospace'
  };

  return !user ? null : (
    <nav style={navStyle}>
      <div style={navLeftStyle}>
        <Link to="/" style={logoStyle}>Logo</Link>
        {user && (
          <ul style={navLinksStyle}>
            <li>
              <Link to="/dashboard" style={linkStyle(isActive('/dashboard'))}>
                Home
              </Link>
            </li>
            <li>
              <Link to="/documents" style={linkStyle(isActive('/documents'))}>
                Documents
              </Link>
            </li>
            <li>
              <Link to="/workspace" style={linkStyle(isActive('/workspace'))}>
                Workspace
              </Link>
            </li>
            <li>
              <Link to="/ai-assistant" style={linkStyle(isActive('/ai-assistant'))}>
                <Sparkles size={16} style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }} />
                AI Assistant
              </Link>
            </li>
          </ul>
        )}
      </div>
      {user && (
        <div style={navRightStyle}>
          <div style={searchBoxStyle}>
            <Search size={16} style={{ opacity: 0.6 }} />
            <input 
              type="text" 
              placeholder="Search..." 
              style={searchInputStyle}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search"
            />
          </div>
          <button 
            style={iconBtnStyle} 
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell size={20} />
          </button>
          <button 
            style={iconBtnStyle} 
            title="Settings"
            aria-label="Settings"
          >
            <Settings size={20} />
          </button>
          <button 
            style={iconBtnStyle} 
            title={darkMode ? "Light Mode" : "Dark Mode"}
            onClick={toggleDarkMode}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <div style={userBadgeStyle}>{getGreeting()}, {user.username || user.email}</div>
          <button 
            style={{...iconBtnStyle, color: 'var(--status-error)', borderColor: 'var(--status-error)'}} 
            title="Logout"
            onClick={onLogout}
            aria-label="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      )}
    </nav>
  );
}

export default Navigation;
