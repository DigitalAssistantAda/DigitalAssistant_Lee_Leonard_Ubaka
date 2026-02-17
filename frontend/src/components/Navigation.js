import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Settings, Moon, Sun, LogOut, Search, Sparkles } from 'lucide-react';
import './Navigation.css';

function Navigation({ user, onLogout }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();


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

  return !user ? null : (
    <div className="nav-shell">
      <nav className="nav-bar">
        <div className="nav-left">
          <Link to="/" className="nav-logo">Ada</Link>
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
            <div className="nav-search">
              <Search size={16} className="nav-search-icon" />
              <input 
                type="text" 
                placeholder="Search..." 
                className="nav-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search"
              />
            </div>
            <button 
              className="nav-icon" 
              title="Notifications"
              aria-label="Notifications"
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
