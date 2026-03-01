import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { X, Plus, Trash2, Check } from 'lucide-react';
import { getApiErrorMessage } from '../utils/apiError';
import { normalizeHexColor, buildAccentStyleVars } from '../utils/accentAccessibility';
import './WorkspaceSettings.css';

function WorkspaceSettings({ workspaceId, onClose, inline = false }) {
  const { id } = useParams();
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteMessage, setInviteMessage] = useState('');
  const [workspaceAccent, setWorkspaceAccent] = useState('');
  const [savingAccent, setSavingAccent] = useState(false);
  const [savingName, setSavingName] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');
  const DEFAULT_ACCENT = '#EBC7D8';
  const ACCENT_PRESETS = ['#DDB9CD', '#9FCFE5', '#BFE3A1', '#EBC6B9'];

  const getDefaultAccent = () => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent-primary')
      .trim();
    return normalizeHexColor(value) || DEFAULT_ACCENT;
  };

  const formatMemberJoinDate = (value) => {
    if (!value) return 'recently';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'recently';
    return parsed.toLocaleDateString([], { month: 'short', year: 'numeric' });
  };

  const getMemberInitials = (member) => {
    const source = member?.username || member?.email || '';
    const clean = source.split('@')[0].trim();
    if (!clean) return '??';
    const parts = clean.split(/[._\s-]+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  };

  const resolvedWorkspaceId = useMemo(() => {
    const fromProp = Number(workspaceId);
    if (!Number.isNaN(fromProp) && Number.isFinite(fromProp)) return fromProp;
    const fromRoute = Number(id);
    if (!Number.isNaN(fromRoute) && Number.isFinite(fromRoute)) return fromRoute;
    return null;
  }, [workspaceId, id]);

  const fetchWorkspaceData = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch workspace details
      const wsResponse = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!wsResponse.ok) {
        const message = await getApiErrorMessage(wsResponse, 'Failed to load workspace settings');
        setError(message);
        return;
      }
      const wsData = await wsResponse.json();
      setWorkspace(wsData);
      setNewName(wsData.name);
      setWorkspaceAccent(normalizeHexColor(wsData.accent_color) || '');

      // Fetch members
      const membersResponse = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!membersResponse.ok) {
        const message = await getApiErrorMessage(membersResponse, 'Failed to load workspace members');
        setError(message);
        return;
      }
      const membersData = await membersResponse.json();
      setMembers(membersData.items || []);

    } catch (err) {
      setError('Failed to load workspace settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [API_URL, resolvedWorkspaceId, token]);

  useEffect(() => {
    if (!resolvedWorkspaceId) {
      setError('Invalid workspace id');
      setLoading(false);
      return;
    }
    fetchWorkspaceData();
  }, [resolvedWorkspaceId, fetchWorkspaceData]);

  const handleUpdateWorkspaceName = async () => {
    if (!newName.trim() || !workspace) return;

    try {
      setSavingName(true);
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName.trim(), accent_color: workspaceAccent || null }),
      });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to update workspace name');
        setError(message);
        return;
      }
      const updated = await response.json();
      setWorkspace(updated);
      setNewName(updated.name);
    } catch (err) {
      setError('Failed to update workspace name');
      console.error(err);
    } finally {
      setSavingName(false);
    }
  };

  const handleUpdateWorkspaceAccent = async () => {
    if (!workspace) return;
    const normalizedAccent = normalizeHexColor(workspaceAccent);
    try {
      setSavingAccent(true);
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: workspace.name,
          accent_color: normalizedAccent || null,
        }),
      });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to update workspace accent');
        setError(message);
        return;
      }
      const updated = await response.json();
      setWorkspace(updated);
      setWorkspaceAccent(normalizeHexColor(updated.accent_color) || '');
    } catch (err) {
      setError('Failed to update workspace accent');
      console.error(err);
    } finally {
      setSavingAccent(false);
    }
  };

  const handleInviteMember = async () => {
    setInviteMessage('');
    if (!inviteEmail.trim()) {
      setInviteMessage('Please enter an email or user ID.');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}/members`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_or_user_id: inviteEmail,
          role: inviteRole,
        }),
      });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to add member');
        setInviteMessage(message);
        return;
      }
      const newMember = await response.json();
      setMembers([...members, newMember]);
      setInviteEmail('');
      setInviteRole('member');
      setInviteMessage('Member invited.');
    } catch (err) {
      setInviteMessage('Failed to add member');
      console.error(err);
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!window.confirm('Remove this member from the workspace?')) return;

    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}/members/${userId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to remove member');
        setError(message);
        return;
      }
      setMembers(members.filter((m) => m.user_id !== userId));
    } catch (err) {
      setError('Failed to remove member');
      console.error(err);
    }
  };

  const handleUpdateRole = async (userId, newRole) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}/members/${userId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: newRole }),
      });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to update role');
        setError(message);
        return;
      }
      const updated = await response.json();
      setMembers(members.map((m) => (m.user_id === userId ? updated : m)));
    } catch (err) {
      setError('Failed to update role');
      console.error(err);
    }
  };

  const selectedAccent = normalizeHexColor(workspaceAccent) || getDefaultAccent();
  const savedAccent = normalizeHexColor(workspace?.accent_color) || '';
  const canSaveAccent = !savingAccent && (savedAccent !== (normalizeHexColor(workspaceAccent) || ''));
  const previewStyle = useMemo(() => {
    if (!selectedAccent) return undefined;
    const rootStyles = getComputedStyle(document.documentElement);
    const bg = rootStyles.getPropertyValue('--bg-secondary').trim() || '#FFFFFF';
    return buildAccentStyleVars(selectedAccent, bg);
  }, [selectedAccent]);

  const handleOverlayClose = () => {
    if (!inline && typeof onClose === 'function') {
      onClose();
    }
  };

  if (loading) {
    if (inline) {
      return (
        <div className="settings-inline-shell">
          <div className="settings-modal-content settings-inline-content">Loading...</div>
        </div>
      );
    }
    return <div className="settings-modal-overlay"><div className="settings-modal-content">Loading...</div></div>;
  }

  return (
    <div className={inline ? 'settings-inline-shell' : 'settings-modal-overlay'} style={previewStyle} onClick={inline ? undefined : handleOverlayClose}>
      <div className={`settings-modal-content ${inline ? 'settings-inline-content' : ''}`} onClick={inline ? undefined : (e) => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h2>Workspace Settings</h2>
            <p>Manage access and preferences for '{workspace?.name || 'this workspace'}'.</p>
          </div>
          {!inline && (
            <button className="close-btn" onClick={handleOverlayClose} title="Close" aria-label="Close settings">
              <X size={20} />
            </button>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}

        {workspace && (
          <div className="settings-form">
            <div className="settings-section">
              <h3 className="settings-eyebrow">Identity</h3>
              <div className="form-group">
                <label htmlFor="workspace-name-input">Workspace Name</label>
                <div className="inline-control-row">
                  <input
                    id="workspace-name-input"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="form-input"
                    placeholder="Workspace name"
                  />
                  <button onClick={handleUpdateWorkspaceName} className="btn-save" disabled={savingName || !newName.trim() || newName.trim() === workspace.name}>
                    {savingName ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="settings-eyebrow">Accent Color</h3>
              <div className="form-group">
                <div className="accent-palette-row">
                  <div className="accent-current" style={{ background: selectedAccent }} aria-hidden="true">
                    <Check size={18} />
                  </div>
                  <div className="accent-divider" aria-hidden="true" />

                  <div className="accent-options" role="listbox" aria-label="Accent color options">
                    {ACCENT_PRESETS.map((color) => {
                      const normalized = color.toUpperCase();
                      const active = selectedAccent === normalized;
                      return (
                        <button
                          key={color}
                          type="button"
                          className={`accent-swatch ${active ? 'active' : ''}`}
                          style={{ background: color }}
                          onClick={() => setWorkspaceAccent(color)}
                          title={`Set accent ${color}`}
                          aria-label={`Set accent ${color}`}
                          aria-pressed={active}
                        />
                      );
                    })}

                    <label className="accent-custom" title="Choose custom accent">
                      <Plus size={16} />
                      <input
                        id="workspace-accent"
                        type="color"
                        value={selectedAccent}
                        onChange={(e) => setWorkspaceAccent(normalizeHexColor(e.target.value) || '')}
                        aria-label="Custom workspace accent color"
                      />
                    </label>
                  </div>

                  <button onClick={handleUpdateWorkspaceAccent} className="btn-save" disabled={!canSaveAccent}>
                    {savingAccent ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <div className="section-header">
                <h3 className="settings-eyebrow">Members ({members.length}/{workspace.member_limit || 10})</h3>
              </div>

              <div className="invite-inline-row">
                <input
                  id="invite-email"
                  type="text"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="form-input"
                  placeholder="Email or user ID"
                />
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="form-input invite-role-input"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button onClick={handleInviteMember} className="btn-add-member" title="Invite member" aria-label="Invite member">
                  Invite
                </button>
              </div>
              {inviteMessage && <p className="invite-message-inline">{inviteMessage}</p>}

              <div className="members-list">
                {members.length === 0 ? (
                  <p className="empty-state">No members yet</p>
                ) : (
                  members.map((member) => (
                    <div key={member.user_id} className="member-row">
                      <div className="member-avatar">{getMemberInitials(member)}</div>
                      <div className="member-info">
                        <div className="member-email">{member.email || member.username || `User ${member.user_id}`}</div>
                        <div className="member-joined">Joined {formatMemberJoinDate(member.joined_at)}</div>
                      </div>
                      <div className="member-controls">
                        {member.role === 'owner' ? (
                          <span className="owner-badge">Owner</span>
                        ) : (
                          <>
                            <select
                              value={member.role}
                              onChange={(e) => handleUpdateRole(member.user_id, e.target.value)}
                              className="role-select"
                              title="Change role"
                            >
                              <option value="member">Member</option>
                              <option value="admin">Admin</option>
                              <option value="owner">Owner</option>
                            </select>
                            <button
                              onClick={() => handleRemoveMember(member.user_id)}
                              className="btn-remove"
                              title="Remove member"
                              aria-label="Remove member"
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspaceSettings;
