import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage, parseApiErrorMessage } from '../utils/apiError';
import './UserSettings.css';

function UserSettings() {
  const [accentColor, setAccentColor] = useState('');
  const [accentSaving, setAccentSaving] = useState(false);
  const [accentError, setAccentError] = useState(null);
  const [accentLoaded, setAccentLoaded] = useState(false);

  const [profile, setProfile] = useState({
    username: '',
    email: '',
    statusMessage: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const navigate = useNavigate();

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  const getDefaultAccent = () => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    return value || '#8f2f5a';
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch(`${API_URL}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setProfile({
            username: data.user.username || '',
            email: data.user.email || '',
            statusMessage: data.user.status_message || '',
          });
          localStorage.setItem('user', JSON.stringify(data.user));
        } else {
          const message = await getApiErrorMessage(response, 'Failed to load account details');
          setProfileError(message);
        }
      } catch (err) {
        setProfileError('Failed to load account details');
      } finally {
        setProfileLoaded(true);
      }
    };

    const fetchPreferences = async () => {
      try {
        const response = await fetch(`${API_URL}/api/v1/users/preferences`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setAccentColor(data.accent_color || '');
        } else {
          const message = await getApiErrorMessage(response, 'Failed to load accent color');
          setAccentError(message);
        }
      } catch (err) {
        setAccentError('Failed to load accent color');
      } finally {
        setAccentLoaded(true);
      }
    };

    if (token) {
      fetchProfile();
      fetchPreferences();
    } else {
      setProfileLoaded(true);
      setAccentLoaded(true);
    }
  }, [API_URL, token]);

  const handleAccentSave = async () => {
    try {
      setAccentSaving(true);
      setAccentError(null);
      const response = await fetch(`${API_URL}/api/v1/users/preferences`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accent_color: accentColor || null }),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to update accent color');
        setAccentError(message);
      } else {
        const data = await response.json();
        setAccentColor(data.accent_color || '');
      }
    } catch (err) {
      setAccentError('Failed to update accent color');
    } finally {
      setAccentSaving(false);
    }
  };

  const handleProfileChange = (event) => {
    const { name, value } = event.target;
    setProfile((prev) => ({ ...prev, [name]: value }));
  };

  const handleProfileSave = async () => {
    try {
      setProfileSaving(true);
      setProfileError(null);
      setProfileSuccess(false);
      const response = await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: profile.username,
          email: profile.email,
          status_message: profile.statusMessage || null,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        if (Array.isArray(errData?.detail)) {
          const messages = errData.detail.map((item) => {
            const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
            if (field === 'email') return `Email: ${item.msg}`;
            if (field === 'username') return `Username: ${item.msg}`;
            if (field === 'status_message') return `Status message: ${item.msg}`;
            return item.msg || 'Invalid account details.';
          });
          setProfileError(messages);
        } else {
          setProfileError(parseApiErrorMessage(errData, 'Failed to update account details'));
        }
        return;
      }

      const data = await response.json();
      setProfile({
        username: data.username || '',
        email: data.email || '',
        statusMessage: data.status_message || '',
      });
      localStorage.setItem('user', JSON.stringify(data));
      setProfileSuccess(true);
    } catch (err) {
      setProfileError('Failed to update account details');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm('Delete your account? This cannot be undone.');
    if (!confirmed) return;

    try {
      const response = await fetch(`${API_URL}/api/v1/users/me`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        setProfileError('Failed to delete account');
        return;
      }

      localStorage.removeItem('token');
      localStorage.removeItem('user');
      navigate('/login');
    } catch (err) {
      setProfileError('Failed to delete account');
    }
  };

  return (
    <div className="user-settings-page">
      <header className="user-settings-header">
        <h1>User Settings</h1>
        <p>Personalize your Ada workspace experience.</p>
      </header>

      <section className="user-settings-card">
        <div className="user-settings-card-header">
          <h2>Account Settings</h2>
          <p>Update the profile details shown across your Ada workspace.</p>
        </div>

        {!profileLoaded ? (
          <div className="user-settings-loading">Loading account settings...</div>
        ) : (
          <div className="user-settings-form">
            {profileError && (
              <div className="user-settings-error">
                {Array.isArray(profileError) ? (
                  <ul className="error-list">
                    {profileError.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                ) : (
                  profileError
                )}
              </div>
            )}
            {profileSuccess && (
              <div className="user-settings-success">Account settings saved.</div>
            )}
            <div className="settings-grid">
              <label className="settings-field">
                <span>Username</span>
                <input
                  type="text"
                  name="username"
                  value={profile.username}
                  onChange={handleProfileChange}
                  className="settings-input"
                  placeholder="Your username"
                />
              </label>
              <label className="settings-field">
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  value={profile.email}
                  onChange={handleProfileChange}
                  className="settings-input"
                  placeholder="you@example.com"
                />
              </label>
            </div>
            <label className="settings-field settings-field-full">
              <span>Status message</span>
              <textarea
                name="statusMessage"
                value={profile.statusMessage}
                onChange={handleProfileChange}
                className="settings-input settings-textarea"
                placeholder="Share a short status with your workspace"
                rows={3}
                maxLength={160}
              />
              <span className="settings-helper">
                {profile.statusMessage.trim().length}/160 characters
              </span>
            </label>
            <div className="settings-actions">
              <button className="accent-save" onClick={handleProfileSave} disabled={profileSaving}>
                {profileSaving ? 'Saving...' : 'Save account details'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="user-settings-card">
        <div className="user-settings-card-header">
          <h2>Accent Color</h2>
          <p>Set your personal accent color for the app.</p>
        </div>

        {!accentLoaded ? (
          <div className="user-settings-loading">Loading settings...</div>
        ) : (
          <div className="user-settings-form">
            {accentError && <div className="user-settings-error">{accentError}</div>}
            <div className="accent-row">
              <input
                type="color"
                value={accentColor || getDefaultAccent()}
                onChange={(e) => setAccentColor(e.target.value)}
                className="accent-input"
                aria-label="Personal accent color"
              />
              <input
                type="text"
                value={accentColor || getDefaultAccent()}
                onChange={(e) => setAccentColor(e.target.value)}
                className="accent-text-input"
                placeholder="#RRGGBB"
              />
              <button className="accent-save" onClick={handleAccentSave} disabled={accentSaving}>
                {accentSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="user-settings-card user-settings-danger">
        <div className="user-settings-card-header">
          <h2>Delete Account</h2>
          <p>This action will deactivate your account and remove access.</p>
        </div>
        <div className="user-settings-form">
          <button className="danger-button" onClick={handleDeleteAccount}>
            Delete account
          </button>
        </div>
      </section>
    </div>
  );
}

export default UserSettings;
