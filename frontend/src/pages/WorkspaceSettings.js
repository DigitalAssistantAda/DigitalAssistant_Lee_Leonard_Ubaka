import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { X, Trash2, Check } from 'lucide-react';
import AccessState from '../components/AccessState';
import ColorSwatchPicker from '../components/ColorSwatchPicker';
import { getApiErrorMessage, isWorkspaceAccessErrorMessage } from '../utils/apiError';
import { normalizeHexColor, buildAccentStyleVars } from '../utils/accentAccessibility';
import { ACCENT_SWATCH_PRESETS } from '../utils/colorPresets';
import LoadingState from '../components/LoadingState';
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
  const [autonomousOrganizationEnabled, setAutonomousOrganizationEnabled] = useState(false);
  const [savingAutonomousOrganization, setSavingAutonomousOrganization] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');
  const DEFAULT_ACCENT = '#EBC7D8';

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

  const currentUserId = useMemo(() => {
    try {
      const rawUser = localStorage.getItem('user');
      if (!rawUser) return null;
      const parsed = JSON.parse(rawUser);
      const userId = Number(parsed?.id ?? parsed?.user_id ?? NaN);
      return Number.isFinite(userId) ? userId : null;
    } catch {
      return null;
    }
  }, []);

  const currentMemberRole = useMemo(() => {
    if (!currentUserId) return null;
    const currentMember = members.find((member) => Number(member?.user_id) === currentUserId);
    const role = String(currentMember?.role || '').toLowerCase();
    return role || null;
  }, [members, currentUserId]);

  const canInviteMembers = currentMemberRole === 'owner';
  const canManageMembers = currentMemberRole === 'owner';

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
      setAutonomousOrganizationEnabled(Boolean(wsData.autonomous_organization_enabled));

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

  useEffect(() => {
    if (!resolvedWorkspaceId) return;

    const handleWorkspaceUpdated = (event) => {
      const changedWorkspaceId = Number(event?.detail?.workspace_id);
      if (Number.isFinite(changedWorkspaceId) && changedWorkspaceId !== Number(resolvedWorkspaceId)) {
        return;
      }
      fetchWorkspaceData();
    };

    window.addEventListener('workspaces-updated', handleWorkspaceUpdated);
    return () => {
      window.removeEventListener('workspaces-updated', handleWorkspaceUpdated);
    };
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
          autonomous_organization_enabled: autonomousOrganizationEnabled,
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

  const handleUpdateAutonomousOrganization = async () => {
    if (!workspace) return;
    try {
      setSavingAutonomousOrganization(true);
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: workspace.name,
          accent_color: workspaceAccent || null,
          autonomous_organization_enabled: autonomousOrganizationEnabled,
        }),
      });
      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to update autonomous organization');
        setError(message);
        return;
      }
      const updated = await response.json();
      setWorkspace(updated);
      setAutonomousOrganizationEnabled(Boolean(updated.autonomous_organization_enabled));
    } catch (err) {
      setError('Failed to update autonomous organization');
      console.error(err);
    } finally {
      setSavingAutonomousOrganization(false);
    }
  };

  const handleInviteMember = async () => {
    setInviteMessage('');

    if (!canInviteMembers) {
      setInviteMessage('Only workspace owners can invite members.');
      return;
    }

    const inviteTarget = inviteEmail.trim();
    if (!inviteTarget) {
      setInviteMessage('Please enter an email, username, or user ID.');
      return;
    }

    const normalizedTarget = inviteTarget.toLowerCase();
    const matchingMember = members.find((member) => {
      const userIdMatch = String(member?.user_id || '').trim() === inviteTarget;
      const emailMatch = String(member?.email || '').trim().toLowerCase() === normalizedTarget;
      const usernameMatch = String(member?.username || '').trim().toLowerCase() === normalizedTarget;
      return userIdMatch || emailMatch || usernameMatch;
    });

    if (matchingMember) {
      const normalizedStatus = String(matchingMember.status || '').toLowerCase();
      if (normalizedStatus === 'active') {
        setInviteMessage('User is already a member of this workspace.');
        return;
      }
      if (normalizedStatus === 'pending') {
        setInviteMessage('This user already has a pending invitation.');
        return;
      }
    }

    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}/members`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_or_user_id: inviteTarget,
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
      setInviteMessage('Invitation sent. The user must accept in Notifications.');
    } catch (err) {
      const raw = String(err?.message || '').toLowerCase();
      if (raw.includes('failed to fetch') || raw.includes('networkerror')) {
        setInviteMessage(`Cannot reach API at ${API_URL}. Check backend/CORS configuration and REACT_APP_API_URL.`);
      } else {
        setInviteMessage(err?.message ? `Failed to add member: ${err.message}` : 'Failed to add member');
      }
      console.error(err);
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!canManageMembers) {
      setError('Only workspace owners can remove members.');
      return;
    }

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
    if (!canManageMembers) {
      setError('Only workspace owners can change member roles.');
      return;
    }

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
          <div className="settings-modal-content settings-inline-content">
            <LoadingState message="Loading workspace settings..." size={36} />
          </div>
        </div>
      );
    }
    return (
      <div className="settings-modal-overlay">
        <div className="settings-modal-content">
          <LoadingState message="Loading workspace settings..." size={40} />
        </div>
      </div>
    );
  }

  if (error && !workspace && isWorkspaceAccessErrorMessage(error)) {
    return (
      <div className={inline ? 'settings-inline-shell' : 'settings-modal-overlay'}>
        <div className={`settings-modal-content ${inline ? 'settings-inline-content' : ''}`}>
          <AccessState
            compact
            title="Workspace access required"
            message="You can’t open these settings because this workspace is unavailable or outside your access scope."
            primaryLabel="View Workspaces"
            primaryTo="/workspace"
          />
        </div>
      </div>
    );
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

                  <ColorSwatchPicker
                    colors={ACCENT_SWATCH_PRESETS}
                    value={selectedAccent}
                    onChange={(nextColor) => setWorkspaceAccent(normalizeHexColor(nextColor) || '')}
                    ariaLabel="Accent color options"
                    optionAriaLabelPrefix="Set accent"
                    customAriaLabel="Custom workspace accent color"
                    customTitle="Choose custom accent"
                  />

                  <button onClick={handleUpdateWorkspaceAccent} className="btn-save" disabled={!canSaveAccent}>
                    {savingAccent ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h3 className="settings-eyebrow">Autonomous Organization</h3>
              <div className="form-group">
                <div className="inline-control-row autonomous-control-row">
                  <label htmlFor="autonomous-organization-toggle" className="autonomous-toggle-control">
                    <input
                      id="autonomous-organization-toggle"
                      type="checkbox"
                      className="autonomous-toggle-input"
                      checked={autonomousOrganizationEnabled}
                      onChange={(e) => setAutonomousOrganizationEnabled(e.target.checked)}
                    />
                    <span className="autonomous-toggle-track" aria-hidden="true">
                      <span className="autonomous-toggle-thumb" />
                    </span>
                    <span className="autonomous-toggle-copy">Auto-organize documents after indexing (high-confidence moves only)</span>
                  </label>
                  <button
                    onClick={handleUpdateAutonomousOrganization}
                    className="btn-save"
                    disabled={savingAutonomousOrganization || Boolean(workspace?.autonomous_organization_enabled) === autonomousOrganizationEnabled}
                  >
                    {savingAutonomousOrganization ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <div className="section-header">
                <h3 className="settings-eyebrow">Members ({members.length}/{workspace.member_limit || 10})</h3>
              </div>

              {canInviteMembers && (
                <div className="invite-inline-row">
                  <input
                    id="invite-email"
                    type="text"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="form-input"
                    placeholder="Email, username, or user ID"
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
              )}
              {!canInviteMembers && <p className="invite-message-inline">Only workspace owners can invite members.</p>}
              {inviteMessage && <p className="invite-message-inline">{inviteMessage}</p>}

              <div className="members-list">
                {members.length === 0 ? (
                  <p className="empty-state">No members yet</p>
                ) : (
                  members.map((member) => (
                    <div key={member.user_id} className="member-row">
                      <div className="member-avatar">{getMemberInitials(member)}</div>
                      <div className="member-info">
                        <div className="member-email-row">
                          <div className="member-email">{member.email || member.username || `User ${member.user_id}`}</div>
                          {String(member.status || '').toLowerCase() === 'pending' && (
                            <span className="member-status-tag pending">Pending</span>
                          )}
                        </div>
                        <div className="member-joined">
                          {String(member.status || '').toLowerCase() === 'pending'
                            ? `Invited ${formatMemberJoinDate(member.joined_at)}`
                            : `Joined ${formatMemberJoinDate(member.joined_at)}`}
                        </div>
                      </div>
                      <div className="member-controls">
                        {member.role === 'owner' ? (
                          <span className="owner-badge">Owner</span>
                        ) : !canManageMembers ? (
                          <span className="owner-badge">{String(member.role || 'member').charAt(0).toUpperCase() + String(member.role || 'member').slice(1)}</span>
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
                              type="button"
                              onClick={() => handleRemoveMember(member.user_id)}
                              className="app-icon-action app-icon-action--danger"
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
