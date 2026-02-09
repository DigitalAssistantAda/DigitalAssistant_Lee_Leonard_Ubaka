import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, Trash2, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import './WorkspaceIssues.css';

function WorkspaceIssues({ workspaceId }) {
  const { id } = useParams();
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
  });

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';
  const token = localStorage.getItem('token');

  const filteredIssues = useMemo(() => {
    if (statusFilter === 'all') return issues;
    return issues.filter((issue) => issue.status === statusFilter);
  }, [issues, statusFilter]);

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
    fetchIssues();
  }, [resolvedWorkspaceId, API_URL, token]);

  const fetchIssues = async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_URL}/api/v1/tasks/${resolvedWorkspaceId}?task_type=issue`,
        {
          headers: { 'Authorization': `Bearer ${token}` },
        }
      );
      if (response.ok) {
        const data = await response.json();
        setIssues(data.items || []);
      }
    } catch (err) {
      setError('Failed to load issues');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateIssue = async () => {
    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/v1/tasks/${resolvedWorkspaceId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: formData.title,
          description: formData.description,
          type: 'issue',
          status: 'open',
          priority: formData.priority,
        }),
      });

      if (response.ok) {
        const newIssue = await response.json();
        setIssues([newIssue, ...issues]);
        setFormData({ title: '', description: '', priority: 'medium' });
        setShowCreateModal(false);
        setError(null);
      }
    } catch (err) {
      setError('Failed to create issue');
      console.error(err);
    }
  };

  const handleUpdateStatus = async (issueId, newStatus) => {
    try {
      const response = await fetch(`${API_URL}/api/v1/tasks/${resolvedWorkspaceId}/${issueId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        const updated = await response.json();
        setIssues(issues.map((i) => (i.id === issueId ? updated : i)));
      }
    } catch (err) {
      setError('Failed to update issue');
      console.error(err);
    }
  };

  const handleDeleteIssue = async (issueId) => {
    if (!window.confirm('Delete this issue?')) return;

    try {
      const response = await fetch(`${API_URL}/api/v1/tasks/${resolvedWorkspaceId}/${issueId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (response.ok) {
        setIssues(issues.filter((i) => i.id !== issueId));
      }
    } catch (err) {
      setError('Failed to delete issue');
      console.error(err);
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'open':
        return <AlertCircle size={16} className="status-icon open" />;
      case 'in_progress':
        return <Clock size={16} className="status-icon in-progress" />;
      case 'completed':
        return <CheckCircle size={16} className="status-icon completed" />;
      default:
        return <AlertCircle size={16} className="status-icon" />;
    }
  };

  const getPriorityClass = (priority) => {
    if (!priority) return 'priority-neutral';
    return `priority-${priority}`;
  };

  if (loading) return <div className="issues-container"><p>Loading issues...</p></div>;

  return (
    <div className="issues-container">
      <div className="issues-header">
        <h2>Issues</h2>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-create-issue"
          title="Create new issue"
          aria-label="Create new issue"
        >
          <Plus size={16} /> New Issue
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {/* Status Filter */}
      <div className="filter-controls">
        <button
          className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          All ({issues.length})
        </button>
        <button
          className={`filter-btn ${statusFilter === 'open' ? 'active' : ''}`}
          onClick={() => setStatusFilter('open')}
        >
          Open ({issues.filter((i) => i.status === 'open').length})
        </button>
        <button
          className={`filter-btn ${statusFilter === 'in_progress' ? 'active' : ''}`}
          onClick={() => setStatusFilter('in_progress')}
        >
          In Progress ({issues.filter((i) => i.status === 'in_progress').length})
        </button>
        <button
          className={`filter-btn ${statusFilter === 'completed' ? 'active' : ''}`}
          onClick={() => setStatusFilter('completed')}
        >
          Completed ({issues.filter((i) => i.status === 'completed').length})
        </button>
      </div>

      {/* Issues List */}
      <div className="issues-list">
        {filteredIssues.length === 0 ? (
          <div className="empty-state">
            <AlertCircle size={32} />
            <p>No issues {statusFilter !== 'all' ? `in "${statusFilter}" status` : 'yet'}</p>
          </div>
        ) : (
          filteredIssues.map((issue) => (
            <div key={issue.id} className="issue-card">
              <div className="issue-top">
                <div className="issue-header-info">
                  <div className="issue-number">#{issue.id}</div>
                  <h3 className="issue-title">{issue.title}</h3>
                </div>
                <button
                  onClick={() => handleDeleteIssue(issue.id)}
                  className="btn-delete-issue"
                  title="Delete issue"
                  aria-label="Delete issue"
                >
                  <Trash2 size={16} />
                </button>
              </div>

              {issue.description && <p className="issue-description">{issue.description}</p>}

              <div className="issue-footer">
                <div className="issue-meta">
                  <div className="meta-item">
                    {getStatusIcon(issue.status)}
                    <span className="status-label">{issue.status.replace('_', ' ')}</span>
                  </div>
                  {issue.priority && (
                    <div className="meta-item">
                      <span
                        className={`priority-badge ${getPriorityClass(issue.priority)}`}
                      >
                        {issue.priority}
                      </span>
                    </div>
                  )}
                </div>

                <select
                  value={issue.status}
                  onChange={(e) => handleUpdateStatus(issue.id, e.target.value)}
                  className="status-select"
                  title="Change status"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Issue Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Issue</h3>
            <div className="form-group">
              <label htmlFor="issue-title">Title</label>
              <input
                id="issue-title"
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="form-input"
                placeholder="Issue title"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="issue-description">Description</label>
              <textarea
                id="issue-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="form-textarea"
                placeholder="Describe the issue (optional)"
                rows="4"
              />
            </div>

            <div className="form-group">
              <label htmlFor="issue-priority">Priority</label>
              <select
                id="issue-priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                className="form-input"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="modal-actions">
              <button onClick={handleCreateIssue} className="btn-primary">Create Issue</button>
              <button onClick={() => setShowCreateModal(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default WorkspaceIssues;
