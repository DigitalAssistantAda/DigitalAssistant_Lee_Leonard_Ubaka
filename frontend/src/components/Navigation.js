import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Settings, Moon, Sun, LogOut, Sparkles, Search, X } from 'lucide-react';
import adaFlower from '../ada_logo.png';
import './Navigation.css';

function Navigation({ user, onLogout }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const logoHoverRef = useRef(0); // timestamp throttle
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const savedMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(savedMode);
    if (savedMode) document.documentElement.classList.add('dark');
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

  const handleNavSearch = (event) => {
    event.preventDefault();
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) return;
    navigate(`/search?q=${encodeURIComponent(trimmedQuery)}`);
    setSearchOpen(false);
  };

  // Hover over logo → petals rain from the upper-left corner
  const handleLogoHover = () => {
    const now = Date.now();
    if (now - logoHoverRef.current < 2500) return; // throttle
    logoHoverRef.current = now;
    window.dispatchEvent(
      new CustomEvent('ada:petalrain', { detail: { maxX: 340, count: 28 } })
    );
  };

  const isActive = (path) => location.pathname === path;

  return !user ? null : (
    <div className="nav-shell">
      <nav className="nav-bar">
        <div className="nav-left">
          {/* ── Logo ──────────────────────────────────────────────── */}
          <Link
            to="/"
            className="nav-logo"
            aria-label="Ada home"
            onMouseEnter={handleLogoHover}
          >
            <img
              src={adaFlower}
              alt="Ada"
              className="nav-logo-img"
              draggable={false}
            />
          </Link>
          {user && (
            <div className="nav-pill" aria-label="Primary navigation">
              <Link to="/dashboard" className={`nav-link ${isActive('/dashboard') ? 'active' : ''}`}>
                Home
              </Link>
              <Link to="/documents" className={`nav-link ${isActive('/documents') ? 'active' : ''}`}>
                Documents
              </Link>
              <Link to="/workspace" className={`nav-link ${isActive('/workspace') ? 'active' : ''}`}>
                Workspace
              </Link>
              <Link to="/ai-assistant" className={`nav-link ${isActive('/ai-assistant') ? 'active' : ''}`}>
                Chat with Ada 

                <Sparkles size={14} className="nav-sparkle-icon" />
              </Link>
            </div>
          )}
        </div>
        {user && (
          <div className="nav-right">
            {searchOpen && (
              <form className="nav-search" onSubmit={handleNavSearch}>
                <input 
                  type="text" 
                  placeholder="Search..." 
                  className="nav-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchOpen(false);
                    }
                  }}
                  aria-label="Search"
                  autoFocus
                />
              </form>
            )}
            {/* ── Search button ──────────────────────────────── */}
            <button
              className="nav-icon"
              title="Search"
              aria-label={searchOpen ? 'Close search' : 'Search'}
              onClick={() => setSearchOpen(!searchOpen)}
            >
              {searchOpen ? <X size={20} /> : <Search size={20} />}
            </button>
            <button 
              className="nav-icon" 
              title="Notifications"
              aria-label="Notifications"
              onClick={() => navigate('/notifications')}
            >
              <Bell size={20} />
            </button>
            <button
              className="nav-icon"
              title="Settings"
              aria-label="Settings"
              onClick={() => navigate('/settings')}
            >
              <Settings size={20} />
            </button>
            <button 
              className="nav-icon" 
              title={darkMode ? "Light Mode" : "Dark Mode"}
              onClick={toggleDarkMode}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button 
              className="nav-icon danger"
              title="Logout"
              onClick={onLogout}
              aria-label="Logout"
            >
              <LogOut size={20} />
            </button>
          </div>
        )}
      </nav>
    </div>
  );
}

export default Navigation;