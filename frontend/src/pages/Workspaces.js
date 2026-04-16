import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, X, Search, ArrowUpRight } from 'lucide-react';
import { getApiErrorMessage } from '../utils/apiError';
import LoadingState from '../components/LoadingState';
import './Workspaces.css';

function Workspaces() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState({ name: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState('recent');
  const [workspaceFilter, setWorkspaceFilter] = useState('all');
  const [selectedWorkspaces, setSelectedWorkspaces] = useState(new Set());

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

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const fetchWorkspaces = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to fetch workspaces');
        throw new Error(message);
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setWorkspaces(items);
    } catch (err) {
      setError(err.message || 'Unable to load workspaces');
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    const handleRealtimeRefresh = () => {
      fetchWorkspaces();
    };

    window.addEventListener('workspaces-updated', handleRealtimeRefresh);
    window.addEventListener('containers-updated', handleRealtimeRefresh);
    window.addEventListener('documents-updated', handleRealtimeRefresh);

    return () => {
      window.removeEventListener('workspaces-updated', handleRealtimeRefresh);
      window.removeEventListener('containers-updated', handleRealtimeRefresh);
      window.removeEventListener('documents-updated', handleRealtimeRefresh);
    };
  }, [fetchWorkspaces]);

  const handleCreateWorkspace = async (e) => {
    e.preventDefault();
    if (!newWorkspace.name.trim()) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newWorkspace),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Failed to create workspace');
        throw new Error(message);
      }

      setNewWorkspace({ name: '' });
      setShowCreateForm(false);
      fetchWorkspaces();
    } catch (err) {
      setError(err.message || 'Failed to create workspace');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedWorkspaces.size === 0) return;
    const count = selectedWorkspaces.size;
    if (!window.confirm(`Delete ${count} workspace${count > 1 ? 's' : ''}?`)) return;

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const deletionPromises = Array.from(selectedWorkspaces).map(id =>
        fetch(`${API_URL}/api/v1/workspaces/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
      );

      await Promise.all(deletionPromises);
      setSelectedWorkspaces(new Set());
      fetchWorkspaces();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckboxChange = (id) => {
    const newSelected = new Set(selectedWorkspaces);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedWorkspaces(newSelected);
  };


  const handleSelectAll = () => {
    if (selectedWorkspaces.size === filteredWorkspaces.length) {
      setSelectedWorkspaces(new Set());
    } else {
      setSelectedWorkspaces(new Set(filteredWorkspaces.map(ws => ws.id)));
    }
  };

  const filteredWorkspaces = useMemo(() => {
    let filtered = workspaces;

    if (workspaceFilter === 'mine') {
      filtered = filtered.filter((workspace) => {
        if (currentUserId == null) return false;
        return Number(workspace?.created_by) === Number(currentUserId);
      });
    }

    if (searchTerm) {
      filtered = filtered.filter(w => w.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    return filtered.sort((a, b) => {
      if (sortOrder === 'name') {
        return a.name.localeCompare(b.name);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [workspaces, searchTerm, sortOrder, workspaceFilter, currentUserId]);

  const workspaceTotals = useMemo(() => {
    return workspaces.reduce(
      (acc, workspace) => {
        acc.documents += workspace.document_count ?? 0;
        acc.members += workspace.member_count ?? 0;
        return acc;
      },
      { documents: 0, members: 0 }
    );
  }, [workspaces]);

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const navigateToWorkspace = (id) => {
    navigate(`/workspace/${id}`);
  };

  return (
    <div className="workspaces-page">
      <div className="workspaces-shell">
        <aside className="workspaces-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-card-header">Workspace summary</div>
            <div className="sidebar-stat">
              <span>Workspaces</span>
              <strong>{workspaces.length}</strong>
            </div>
            <div className="sidebar-stat">
              <span>Documents</span>
              <strong>{workspaceTotals.documents}</strong>
            </div>
            <div className="sidebar-stat">
              <span>Members</span>
              <strong>{workspaceTotals.members}</strong>
            </div>
          </div>

          <div className="sidebar-card">
            <div className="sidebar-card-header">Filter & search</div>
            <div className="workspaces-controls">
              <div className="controls-left">
                <label className="control-label">
                  Workspace scope
                  <select value={workspaceFilter} onChange={(e) => setWorkspaceFilter(e.target.value)}>
                    <option value="all">All Workspaces</option>
                    <option value="mine">My Workspaces</option>
                  </select>
                </label>
                <label className="control-label">
                  Sort by
                  <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                    <option value="recent">Most Recent</option>
                    <option value="name">Name (A-Z)</option>
                  </select>
                </label>
              </div>
              <div className="search-box">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Search workspaces..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  aria-label="Search workspaces"
                />
              </div>
            </div>
          </div>

          <div className="sidebar-card sidebar-actions">
            <button
              className="btn btn-primary"
              onClick={() => setShowCreateForm((v) => !v)}
              title="Create new workspace"
              aria-label="Create new workspace"
            >
              <Plus size={14} />
              New Workspace
            </button>

            {showCreateForm && (
              <div className="create-workspace-panel" role="region" aria-label="Create workspace panel">
                <div className="panel-header">
                  <strong>Create Workspace</strong>
                  <button className="panel-close" onClick={() => setShowCreateForm(false)} aria-label="Close">
                    <X size={14} />
                  </button>
                </div>
                <form onSubmit={handleCreateWorkspace}>
                  <label className="panel-label" htmlFor="workspace-name">Name...</label>
                  <input
                    id="workspace-name"
                    type="text"
                    placeholder="Workspace name"
                    value={newWorkspace.name}
                    onChange={(e) => setNewWorkspace({ name: e.target.value })}
                    required
                    autoFocus
                  />
                  <div className="panel-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowCreateForm(false)}>Cancel</button>
                    <button type="submit" className="btn btn-primary">Create</button>
                  </div>
                </form>
              </div>
            )}

            <button
              className="btn btn-secondary"
              onClick={() => fetchWorkspaces()}
              title="Refresh workspaces"
              aria-label="Refresh workspaces"
            >
              Refresh
            </button>
          </div>
        </aside>

        <main className="workspaces-main">
          <header className="workspaces-hero">
            <div className="hero-content">
              <h1>Workspaces</h1>
              <p>Track the spaces, documents, and teams powering your workspace.</p>
            </div>
          </header>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button 
            className="close-error"
            onClick={() => setError(null)}
            aria-label="Close error message"
          >
            <X size={16} />
          </button>
        </div>
      )}


          {selectedWorkspaces.size > 0 && (
            <div className="bulk-actions-bar">
              <div className="bulk-info">
                <input 
                  type="checkbox"
                  checked={selectedWorkspaces.size === filteredWorkspaces.length}
                  onChange={handleSelectAll}
                  title={selectedWorkspaces.size === filteredWorkspaces.length ? 'Deselect all' : 'Select all'}
                  aria-label={selectedWorkspaces.size === filteredWorkspaces.length ? 'Deselect all workspaces' : 'Select all workspaces'}
                />
                <span>{selectedWorkspaces.size} selected</span>
              </div>
              <button 
                className="action-btn delete-btn"
                onClick={handleBulkDelete}
                title="Delete selected workspaces"
                aria-label={`Delete ${selectedWorkspaces.size} workspace${selectedWorkspaces.size > 1 ? 's' : ''}`}
              >
                <Trash2 size={18} />
                Delete
              </button>
            </div>
          )}

          <div className="workspaces-list">
            {loading ? (
              <LoadingState className="loading" message="Loading workspaces..." size={36} />
            ) : filteredWorkspaces.length === 0 ? (
              <div className="empty-state">
                <p>No workspaces found</p>
                <button className="btn btn-primary" onClick={() => setShowCreateForm(true)}>
                  Create your first workspace
                </button>
              </div>
            ) : (
              <div className="workspace-grid">
                {filteredWorkspaces.map((workspace) => (
                  <div key={workspace.id} className="workspace-row">
                    <div className="workspace-row-select">
                      <input
                        type="checkbox"
                        checked={selectedWorkspaces.has(workspace.id)}
                        onChange={() => handleCheckboxChange(workspace.id)}
                        title="Select workspace"
                        aria-label={`Select ${workspace.name}`}
                      />
                    </div>
                    <div className="workspace-row-leading">
                      <span className="workspace-avatar">
                        {workspace.name?.trim()?.charAt(0)?.toUpperCase() || 'W'}
                      </span>
                    </div>
                    <div className="workspace-row-main" onClick={() => navigateToWorkspace(workspace.id)}>
                      <div className="workspace-row-title">
                        <div>
                          <h3>{workspace.name}</h3>
                          <span className="workspace-created">Created {formatDate(workspace.created_at)}</span>
                        </div>
                      </div>
                      <div className="workspace-row-meta">
                        <span>{workspace.document_count ?? 0} documents</span>
                        <span>{workspace.member_count ?? 0} members</span>
                        <span>Workspace #{workspace.id}</span>
                      </div>
                    </div>
                    <div className="workspace-row-actions">
                      <button
                        className="btn btn-ghost workspace-open"
                        onClick={() => navigateToWorkspace(workspace.id)}
                        title="Open workspace"
                        aria-label={`Open ${workspace.name}`}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default Workspaces;
