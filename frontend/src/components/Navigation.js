import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Moon, Sun, LogOut, Settings, Search, X } from 'lucide-react';
import adaFlower from '../ada_logo.png';
import './Navigation.css';

function Navigation({ user, onLogout }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const profileInitial = (user?.username || 'A').charAt(0).toUpperCase();

  useEffect(() => {
    const savedMode = localStorage.getItem('darkMode') === 'true';
    setDarkMode(savedMode);
    if (savedMode) document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    let cancelled = false;

    const fetchNotificationCount = async () => {
      try {
        const token = localStorage.getItem('token');
        const rawUser = localStorage.getItem('user');
        if (!token || !rawUser) {
          if (!cancelled) setNotificationCount(0);
          return;
        }

        const parsed = JSON.parse(rawUser);
        const currentUserId = Number(parsed?.id ?? parsed?.user_id ?? NaN);
        if (!Number.isFinite(currentUserId)) {
          if (!cancelled) setNotificationCount(0);
          return;
        }

        const [mentionsResponse, invitationsResponse, deletionRequestsResponse] = await Promise.all([
          fetch(`${API_URL}/api/v1/audit-logs?action=message.mentioned&limit=200`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
          fetch(`${API_URL}/api/v1/workspaces/invitations/pending`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
          fetch(`${API_URL}/api/v1/deletion-requests/pending`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }),
        ]);

        let mentionCount = 0;
        if (mentionsResponse.ok) {
          const mentionsData = await mentionsResponse.json();
          const logs = Array.isArray(mentionsData?.logs) ? mentionsData.logs : [];
          mentionCount = logs.reduce((total, log) => {
            let metadata = {};
            if (typeof log?.metadata_json === 'string') {
              try {
                metadata = JSON.parse(log.metadata_json);
              } catch {
                metadata = {};
              }
            } else if (log?.metadata_json && typeof log.metadata_json === 'object') {
              metadata = log.metadata_json;
            }

            const mentionedUserId = Number(metadata?.mentioned_user_id);
            return mentionedUserId === currentUserId ? total + 1 : total;
          }, 0);
        }

        let invitationsCount = 0;
        if (invitationsResponse.ok) {
          const invitationsData = await invitationsResponse.json();
          const invitations = Array.isArray(invitationsData?.items) ? invitationsData.items : [];
          invitationsCount = invitations.length;
        }

        let deletionRequestsCount = 0;
        if (deletionRequestsResponse.ok) {
          const requestsData = await deletionRequestsResponse.json();
          const requests = Array.isArray(requestsData?.requests) ? requestsData.requests : [];
          deletionRequestsCount = requests.length;
        }

        if (!cancelled) {
          setNotificationCount(mentionCount + invitationsCount + deletionRequestsCount);
        }
      } catch (error) {
        if (!cancelled) {
          setNotificationCount(0);
        }
      }
    };

    fetchNotificationCount();
    const intervalId = window.setInterval(fetchNotificationCount, 60000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [API_URL, location.pathname]);

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
            {notificationCount > 0 && (
              <span className="nav-notification-badge" aria-label={`${notificationCount} notifications`}>
                {notificationCount > 99 ? '99+' : notificationCount}
              </span>
            )}
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