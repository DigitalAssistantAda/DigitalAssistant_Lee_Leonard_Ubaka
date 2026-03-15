import React, { useState, useEffect, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import './Search.css';
import { apiFetch } from '../utils/apiClient';

function Search() {
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const location = useLocation();

  const fetchWorkspaces = useCallback(async () => {
    try {
      const data = await apiFetch('/api/v1/workspaces');
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setWorkspaces(items);
      if (items.length > 0) {
        setSelectedWorkspace((prev) => {
          if (prev && items.some((workspace) => String(workspace.id) === String(prev))) {
            return prev;
          }
          return String(items[0].id);
        });
      } else {
        setSelectedWorkspace('');
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
    }
  }, []);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    const handleWorkspaceUpdated = () => {
      fetchWorkspaces();
    };

    window.addEventListener('workspaces-updated', handleWorkspaceUpdated);
    return () => {
      window.removeEventListener('workspaces-updated', handleWorkspaceUpdated);
    };
  }, [fetchWorkspaces]);

  const runSearch = useCallback(async (queryValue, workspaceId) => {
    const trimmedQuery = (queryValue || '').trim();
    if (!trimmedQuery || !workspaceId) {
      setError('Select a workspace and enter a search query.');
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSearchResults([]);

    try {
      const data = await apiFetch('/api/v1/search', {
        method: 'POST',
        body: {
          workspace_id: Number(workspaceId),
          query: trimmedQuery,
          limit: 10,
        },
      });
      setSearchResults(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = async (e) => {
    e.preventDefault();
    await runSearch(query, selectedWorkspace);
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const queryFromNav = (params.get('q') || '').trim();
    const workspaceFromNav = (params.get('workspace_id') || '').trim();

    if (workspaceFromNav) {
      setSelectedWorkspace(workspaceFromNav);
    }

    if (!queryFromNav) {
      return;
    }

    setQuery(queryFromNav);

    const workspaceIdToUse = workspaceFromNav || selectedWorkspace;
    if (workspaceIdToUse) {
      runSearch(queryFromNav, workspaceIdToUse);
    }
  }, [location.search, selectedWorkspace, runSearch]);

  return (
    <div className="search-page">
      <div className="search-hero">
        <p className="search-eyebrow">Workspace Search</p>
        <h1>Search Documents</h1>
        <p className="search-subtitle">Use search to locate exact passages. Use Chat with Ada for summaries, answers, and follow-up questions grounded in selected documents.</p>
      </div>

      <div className="search-mode-note">
        <p>
          Chat is the primary assistant workflow. Search helps you find the right source material first.
          <Link to="/ai-assistant" className="search-mode-link"> Open Chat with Ada</Link>
        </p>
      </div>

      {error && (
        <div className="search-error">
          Error: {error}
        </div>
      )}

      <div className="search-card">
        <form onSubmit={handleSearch} className="search-form">
          <div className="search-field">
            <label>Workspace:</label>
            <select
              value={selectedWorkspace}
              onChange={(e) => setSelectedWorkspace(e.target.value)}
              required
              className="search-select"
            >
              <option value="">Select a workspace</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          </div>
          <div className="search-field">
            <label>Search Query:</label>
            <div className="search-input-shell">
              <SearchIcon size={16} className="search-input-icon" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Enter search terms..."
                required
                className="search-input"
              />
            </div>
          </div>
          <div className="search-actions">
            <button 
              type="submit" 
              disabled={loading || !selectedWorkspace}
              className="search-button"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>
      </div>

      {searchResults.length > 0 && (
        <section className="search-results-section">
          <div className="search-results-header">
            <h2>Search Results</h2>
            <span className="search-results-count">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="search-results-grid">
            {searchResults.map((result, index) => (
              <div 
                key={index} 
                className="search-result-card"
              >
                <h3>{result.title || result.filename || 'Untitled Document'}</h3>
                {result.snippet && (
                  <p className="search-result-snippet">
                    {result.snippet}
                  </p>
                )}
                {!result.snippet && (
                  <p className="search-result-snippet search-result-snippet-empty">
                    No preview is available for this match yet.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {!loading && !error && hasSearched && searchResults.length === 0 && (
        <p className="search-empty">No matching documents were found in this workspace. Try different keywords.</p>
      )}
    </div>
  );
}

export default Search;
