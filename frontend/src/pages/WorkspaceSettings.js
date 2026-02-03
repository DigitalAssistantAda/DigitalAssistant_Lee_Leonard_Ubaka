import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { X, Plus, Trash2 } from 'lucide-react';
import './WorkspaceSettings.css';

function WorkspaceSettings({ workspaceId, onClose }) {
  const { id } = useParams();
  const [workspace, setWorkspace] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  const resolvedWorkspaceId = useMemo(() => {
    const fromProp = Number(workspaceId);
    if (!Number.isNaN(fromProp) && Number.isFinite(fromProp)) return fromProp;
    const fromRoute = Number(id);
    if (!Number.isNaN(fromRoute) && Number.isFinite(fromRoute)) return fromRoute;
    return null;
  }, [workspaceId, id]);

  useEffect(() => {
    if (!resolvedWorkspaceId) {
      setError('Invalid workspace id');
      setLoading(false);
      return;
    }
    fetchWorkspaceData();
  }, [resolvedWorkspaceId, API_URL, token]);

  const fetchWorkspaceData = async () => {
    try {
      setLoading(true);
      // Fetch workspace details
      const wsResponse = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (wsResponse.ok) {
        const wsData = await wsResponse.json();
        setWorkspace(wsData);
        setNewName(wsData.name);
      }

      // Fetch members
      const membersResponse = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (membersResponse.ok) {
        const membersData = await membersResponse.json();
        setMembers(membersData.items || []);
      }
    } catch (err) {
      setError('Failed to load workspace settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateWorkspaceName = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/workspaces/${resolvedWorkspaceId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      });
      if (response.ok) {
        const updated = await response.json();
        setWorkspace(updated);
        setEditingName(false);
      }
    } catch (err) {
      setError('Failed to update workspace name');
      console.error(err);
    }
  };

  const handleInviteMember = async () => {
    if (!inviteEmail.trim()) {
      setError('Please enter an email');
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
      if (response.ok) {
        const newMember = await response.json();
        setMembers([...members, newMember]);
        setInviteEmail('');
        setInviteRole('member');
        setShowInviteModal(false);
      } else {
        const errData = await response.json();
        setError(errData.detail || 'Failed to add member');
      }
    } catch (err) {
      setError('Failed to add member');
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
      if (response.ok) {
        setMembers(members.filter((m) => m.user_id !== userId));
      }
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
      if (response.ok) {
        const updated = await response.json();
        setMembers(members.map((m) => (m.user_id === userId ? updated : m)));
      }
    } catch (err) {
      setError('Failed to update role');
      console.error(err);
    }
  };

  if (loading) return <div className="settings-modal-overlay"><div className="settings-modal-content">Loading...</div></div>;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Workspace Settings</h2>
          <button className="close-btn" onClick={onClose} title="Close" aria-label="Close settings">
            <X size={20} />
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        {workspace && (
          <div className="settings-form">
            {/* Workspace Name */}
            <div className="settings-section">
              <h3>Workspace Name</h3>
              <div className="form-group">
                {editingName ? (
                  <div className="edit-row">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="form-input"
                      placeholder="Workspace name"
                    />
                    <button onClick={handleUpdateWorkspaceName} className="btn-save">Save</button>
                    <button onClick={() => setEditingName(false)} className="btn-cancel">Cancel</button>
                  </div>
                ) : (
                  <div className="edit-row">
                    <div className="readonly-value">{workspace.name}</div>
                    <button onClick={() => setEditingName(true)} className="btn-edit">Edit</button>
                  </div>
                )}
              </div>
            </div>

            {/* Members */}
            <div className="settings-section">
              <div className="section-header">
                <h3>Members</h3>
                <button onClick={() => setShowInviteModal(true)} className="btn-add-member" title="Add member" aria-label="Add member">
                  <Plus size={16} /> Invite
                </button>
              </div>

              <div className="members-list">
                {members.length === 0 ? (
                  <p className="empty-state">No members yet</p>
                ) : (
                  members.map((member) => (
                    <div key={member.user_id} className="member-row">
                      <div className="member-info">
                        <div className="member-email">{member.email || `User ${member.user_id}`}</div>
                        <div className="member-joined">Joined {member.joined_at || 'recently'}</div>
                      </div>
                      <div className="member-controls">
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
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Invite Modal */}
        {showInviteModal && (
          <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()}>
              <h3>Invite Member</h3>
              <div className="form-group">
                <label htmlFor="invite-email">Email Address</label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="form-input"
                  placeholder="user@example.com"
                />
              </div>
              <div className="form-group">
                <label htmlFor="invite-role">Role</label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="form-input"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="modal-actions">
                <button onClick={handleInviteMember} className="btn-primary">Invite</button>
                <button onClick={() => setShowInviteModal(false)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkspaceSettings;
