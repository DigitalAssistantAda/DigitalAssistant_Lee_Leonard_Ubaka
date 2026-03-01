import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Moon, Sun, LogOut, Settings, Search, X } from 'lucide-react';
import adaFlower from '../ada_logo.png';
import './Navigation.css';

function Navigation({ user, onLogout }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const profileInitial = (user?.username || 'A').charAt(0).toUpperCase();

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

  const isActive = (path) => location.pathname === path;

  return !user ? null : (
    <nav className="nav-shell">
      <div className="nav-inner">
        <Link
          to="/"
          className="nav-logo"
          aria-label="Ada home"
        >
          <img
            src={adaFlower}
            alt="Ada"
            className="nav-logo-img"
            draggable={false}
          />
        </Link>

        <div className="nav-links" aria-label="Primary navigation">
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
          </Link>
        </div>

        <div className="nav-actions">
          {searchOpen ? (
            <form className="nav-search" onSubmit={handleNavSearch}>
              <Search size={15} className="nav-search-icon" />
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
              <button
                type="button"
                className="nav-search-close"
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
              >
                <X size={14} />
              </button>
            </form>
          ) : (
            <button
              className="nav-icon"
              title="Search"
              aria-label="Search"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={18} />
            </button>
          )}

          <button
            className="nav-icon"
            title="Notifications"
            aria-label="Notifications"
            onClick={() => navigate('/notifications')}
          >
            <Bell size={18} />
          </button>

          <button
            className="nav-icon"
            title="Settings"
            aria-label="Settings"
            onClick={() => navigate('/settings')}
          >
            <Settings size={18} />
          </button>

          <button
            className="nav-icon"
            title={darkMode ? 'Light Mode' : 'Dark Mode'}
            onClick={toggleDarkMode}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <button
            className="nav-icon"
            title="Logout"
            onClick={onLogout}
            aria-label="Logout"
          >
            <LogOut size={18} />
          </button>

          <button
            className="nav-avatar"
            title={user.username || 'Profile'}
            onClick={() => navigate('/dashboard')}
            aria-label="User profile"
          >
            {profileInitial}
          </button>
        </div>
      </div>
    </nav>
  );
}

export default Navigation;