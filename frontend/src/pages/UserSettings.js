import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage, parseApiErrorMessage } from '../utils/apiError';
import ColorSwatchPicker from '../components/ColorSwatchPicker';
import { normalizeHexColor } from '../utils/accentAccessibility';
import { ACCENT_SWATCH_PRESETS } from '../utils/colorPresets';
import LoadingState from '../components/LoadingState';
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
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const navigate = useNavigate();

  const [embeddingModel, setEmbeddingModel] = useState(null);
  const [embeddingModelError, setEmbeddingModelError] = useState(null);
  const [trainingJobs, setTrainingJobs] = useState([]);
  const [embeddingRefreshLoading, setEmbeddingRefreshLoading] = useState(false);
  const [embeddingFinetuneLoading, setEmbeddingFinetuneLoading] = useState(false);
  const [embeddingActionMessage, setEmbeddingActionMessage] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  const getDefaultAccent = () => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    return normalizeHexColor(value) || '#8F2F5A';
  };

  const selectedAccent = normalizeHexColor(accentColor) || getDefaultAccent();

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

    const fetchEmbeddingModel = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/embeddings/model`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setEmbeddingModel(data);
        }
      } catch (e) {
        setEmbeddingModelError('Could not load embedding model info');
      }
    };
    const fetchTrainingJobs = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/embeddings/training/jobs?limit=10`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setTrainingJobs(Array.isArray(data) ? data : []);
        }
      } catch (_) {}
    };
    if (token) {
      fetchProfile();
      fetchPreferences();
      fetchEmbeddingModel();
      fetchTrainingJobs();
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

  const handlePasswordFormChange = (event) => {
    const { name, value } = event.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));
    setPasswordSuccess(false);
  };

  const handleEmbeddingRefresh = async () => {
    setEmbeddingActionMessage(null);
    setEmbeddingRefreshLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/embeddings/refresh`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmbeddingActionMessage(data?.detail || 'Failed to queue refresh');
        return;
      }
      setEmbeddingActionMessage('Refresh queued. Documents will be re-embedded in the background.');
      const jobsRes = await fetch(`${API_URL}/api/v1/embeddings/training/jobs?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (jobsRes.ok) {
        const jobs = await jobsRes.json();
        setTrainingJobs(Array.isArray(jobs) ? jobs : []);
      }
    } catch (err) {
      setEmbeddingActionMessage('Failed to trigger refresh');
    } finally {
      setEmbeddingRefreshLoading(false);
    }
  };

  const handleEmbeddingFinetune = async () => {
    setEmbeddingActionMessage(null);
    setEmbeddingFinetuneLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/embeddings/fine-tune`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ epochs: 1, trigger_refresh_after: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmbeddingActionMessage(data?.detail || 'Failed to queue fine-tune');
        return;
      }
      setEmbeddingActionMessage('Fine-tune queued. The model will train on your documents, then re-embed.');
      const jobsRes = await fetch(`${API_URL}/api/v1/embeddings/training/jobs?limit=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (jobsRes.ok) {
        const jobs = await jobsRes.json();
        setTrainingJobs(Array.isArray(jobs) ? jobs : []);
      }
    } catch (err) {
      setEmbeddingActionMessage('Failed to trigger fine-tune');
    } finally {
      setEmbeddingFinetuneLoading(false);
    }
  };

  const handlePasswordSave = async () => {
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      setPasswordError('Please fill in all password fields.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }

    try {
      setPasswordSaving(true);
      const response = await fetch(`${API_URL}/api/v1/auth/change-password`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        if (Array.isArray(errData?.detail)) {
          setPasswordError(errData.detail.map((item) => item?.msg || 'Invalid password input.').join(' '));
        } else {
          setPasswordError(parseApiErrorMessage(errData, 'Failed to update password'));
        }
        return;
      }

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordSuccess(true);
    } catch (err) {
      setPasswordError('Failed to update password');
    } finally {
      setPasswordSaving(false);
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
          <LoadingState className="user-settings-loading" message="Loading account settings..." size={34} />
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
          <LoadingState className="user-settings-loading" message="Loading settings..." size={34} />
        ) : (
          <div className="user-settings-form">
            {accentError && <div className="user-settings-error">{accentError}</div>}
            <div className="accent-row">
              <ColorSwatchPicker
                colors={ACCENT_SWATCH_PRESETS}
                value={selectedAccent}
                onChange={(nextColor) => setAccentColor(normalizeHexColor(nextColor) || '')}
                ariaLabel="Personal accent color options"
                optionAriaLabelPrefix="Set accent"
                customAriaLabel="Personal accent color"
                customTitle="Choose custom accent"
              />
              <input
                type="text"
                value={accentColor || selectedAccent}
                onChange={(e) => setAccentColor((e.target.value || '').toUpperCase())}
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

      <section className="user-settings-card">
        <div className="user-settings-card-header">
          <h2>Password</h2>
          <p>Update your password for account security.</p>
        </div>

        <div className="user-settings-form">
          {passwordError && <div className="user-settings-error">{passwordError}</div>}
          {passwordSuccess && (
            <div className="user-settings-success">Password updated successfully.</div>
          )}

          <div className="settings-grid">
            <label className="settings-field settings-field-full">
              <span>Current password</span>
              <input
                type="password"
                name="currentPassword"
                value={passwordForm.currentPassword}
                onChange={handlePasswordFormChange}
                className="settings-input"
                placeholder="Enter current password"
                autoComplete="current-password"
              />
            </label>
            <label className="settings-field">
              <span>New password</span>
              <input
                type="password"
                name="newPassword"
                value={passwordForm.newPassword}
                onChange={handlePasswordFormChange}
                className="settings-input"
                placeholder="At least 12 characters"
                autoComplete="new-password"
              />
              <span className="password-helper">Use 12+ characters with uppercase, lowercase, number, and special character.</span>
            </label>
            <label className="settings-field">
              <span>Confirm new password</span>
              <input
                type="password"
                name="confirmPassword"
                value={passwordForm.confirmPassword}
                onChange={handlePasswordFormChange}
                className="settings-input"
                placeholder="Re-enter new password"
                autoComplete="new-password"
              />
            </label>
          </div>

          <div className="settings-actions">
            <button className="accent-save" onClick={handlePasswordSave} disabled={passwordSaving}>
              {passwordSaving ? 'Saving...' : 'Save password'}
            </button>
          </div>
        </div>
      </section>

      <section className="user-settings-card">
        <div className="user-settings-card-header">
          <h2>Embeddings & search model</h2>
          <p>Manage the local embedding model used for semantic search. You can re-embed all documents or fine-tune the model on your data.</p>
        </div>
        <div className="user-settings-form">
          {embeddingModelError && <div className="user-settings-error">{embeddingModelError}</div>}
          {embeddingModel && (
            <>
              <div className="embedding-model-info">
                <p><strong>Service:</strong> {embeddingModel.service}</p>
                <p><strong>Model:</strong> {embeddingModel.model_name}</p>
                <p><strong>Dimension:</strong> {embeddingModel.embedding_dimension}</p>
                {embeddingModel.supports_fine_tune && (
                  <p className="settings-helper">Fine-tuning is available for this model.</p>
                )}
              </div>
              <div className="settings-actions" style={{ marginTop: '1rem' }}>
                <button
                  className="accent-save"
                  onClick={handleEmbeddingRefresh}
                  disabled={embeddingRefreshLoading}
                >
                  {embeddingRefreshLoading ? 'Queuing...' : 'Refresh all embeddings'}
                </button>
                {embeddingModel.supports_fine_tune && (
                  <button
                    className="accent-save"
                    onClick={handleEmbeddingFinetune}
                    disabled={embeddingFinetuneLoading}
                    style={{ marginLeft: '0.75rem' }}
                  >
                    {embeddingFinetuneLoading ? 'Queuing...' : 'Fine-tune model on documents'}
                  </button>
                )}
              </div>
              {embeddingActionMessage && (
                <div className="user-settings-success" style={{ marginTop: '0.75rem' }}>
                  {embeddingActionMessage}
                </div>
              )}
            </>
          )}
          {trainingJobs.length > 0 && (
            <div className="embedding-jobs-list" style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>Recent jobs</h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {trainingJobs.map((j) => (
                  <li key={j.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)' }}>
                    <span style={{ fontWeight: 500 }}>{j.job_type}</span> — {j.status}
                    {j.documents_processed != null && j.documents_total != null && (
                      <span> ({j.documents_processed}/{j.documents_total})</span>
                    )}
                    {j.error_message && <span style={{ color: 'var(--status-danger)' }}> — {j.error_message}</span>}
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}> — {new Date(j.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p className="settings-helper" style={{ marginTop: '0.5rem' }}>
                To run a weekly refresh automatically, set EMBEDDING_REFRESH_ENABLED=true and run Celery Beat.
              </p>
            </div>
          )}
        </div>
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
