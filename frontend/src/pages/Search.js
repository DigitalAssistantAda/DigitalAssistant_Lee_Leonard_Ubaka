import React, { useState, useEffect } from 'react';
import './Search.css';

function Search() {
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
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
          setSelectedWorkspace(items[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching workspaces:', err);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim() || !selectedWorkspace) return;

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(
        `${API_URL}/api/v1/search?workspace_id=${selectedWorkspace}&query=${encodeURIComponent(query)}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setSearchResults(data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="search-page">
      <h1>Search Documents</h1>

      {error && (
        <div className="search-error">
          Error: {error}
        </div>
      )}

      <div className="search-card">
        <form onSubmit={handleSearch}>
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
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter search terms..."
              required
              className="search-input"
            />
          </div>
          <button 
            type="submit" 
            disabled={loading || !selectedWorkspace}
            className="search-button"
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {searchResults.length > 0 && (
        <div>
          <h2>Search Results ({searchResults.length})</h2>
          <div className="search-results-grid">
            {searchResults.map((result, index) => (
              <div 
                key={index} 
                className="search-result-card"
              >
                <h3>{result.document_name || 'Untitled Document'}</h3>
                <p className="search-result-meta">
                  Relevance Score: {result.score ? result.score.toFixed(2) : 'N/A'}
                </p>
                {result.snippet && (
                  <p className="search-result-snippet">
                    {result.snippet}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && searchResults.length === 0 && query && (
        <p>No results found for "{query}"</p>
      )}
    </div>
  );
}

export default Search;
