import React, { useEffect, useState } from 'react';
import './UserSettings.css';

function UserSettings() {
  const [accentColor, setAccentColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  const getDefaultAccent = () => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    return value || '#8f2f5a';
  };

  useEffect(() => {
    const fetchPreferences = async () => {
      try {
        const response = await fetch(`${API_URL}/api/v1/users/preferences`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setAccentColor(data.accent_color || '');
        } else {
          setError('Failed to load user settings');
        }
      } catch (err) {
        setError('Failed to load user settings');
      } finally {
        setLoaded(true);
      }
    };

    if (token) {
      fetchPreferences();
    } else {
      setLoaded(true);
    }
  }, [API_URL, token]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`${API_URL}/api/v1/users/preferences`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accent_color: accentColor || null }),
      });

      if (!response.ok) {
        const errData = await response.json();
        setError(errData.detail || 'Failed to update accent color');
      } else {
        const data = await response.json();
        setAccentColor(data.accent_color || '');
      }
    } catch (err) {
      setError('Failed to update accent color');
    } finally {
      setSaving(false);
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
          <h2>Accent Color</h2>
          <p>Set your personal accent color for the app.</p>
        </div>

        {!loaded ? (
          <div className="user-settings-loading">Loading settings...</div>
        ) : (
          <div className="user-settings-form">
            {error && <div className="user-settings-error">{error}</div>}
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
              <button className="accent-save" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default UserSettings;
