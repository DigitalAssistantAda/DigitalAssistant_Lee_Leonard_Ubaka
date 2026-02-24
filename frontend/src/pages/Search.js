import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { getApiErrorMessage } from '../utils/apiError';
import './Search.css';

function Search() {
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const location = useLocation();

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const fetchWorkspaces = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
        setWorkspaces(items);
        if (items.length > 0) {
          setSelectedWorkspace(String(items[0].id));
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
    }
  }, [API_URL]);

  useEffect(() => {
    fetchWorkspaces();
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
      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/v1/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspace_id: Number(workspaceId),
          query: trimmedQuery,
          limit: 10,
        }),
      });

      if (!response.ok) {
        const message = await getApiErrorMessage(response, 'Search failed');
        throw new Error(message);
      }

      const data = await response.json();
      setSearchResults(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

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
        <p className="search-subtitle">Find relevant documents and excerpts inside a specific workspace.</p>
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
