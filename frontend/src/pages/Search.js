import React, { useState, useEffect } from 'react';

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
        setWorkspaces(data);
        if (data.length > 0) {
          setSelectedWorkspace(data[0].id);
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
    <div style={{ padding: '20px' }}>
      <h1>Search Documents</h1>

      {error && (
        <div style={{ color: 'red', padding: '10px', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      <div style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <form onSubmit={handleSearch}>
          <div style={{ marginBottom: '15px' }}>
            <label>Workspace:</label>
            <select
              value={selectedWorkspace}
              onChange={(e) => setSelectedWorkspace(e.target.value)}
              required
              style={{ width: '100%', padding: '8px' }}
            >
              <option value="">Select a workspace</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>{ws.name}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label>Search Query:</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter search terms..."
              required
              style={{ width: '100%', padding: '8px' }}
            />
          </div>
          <button 
            type="submit" 
            disabled={loading || !selectedWorkspace}
            style={{ padding: '10px 20px', cursor: 'pointer' }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {searchResults.length > 0 && (
        <div>
          <h2>Search Results ({searchResults.length})</h2>
          <div style={{ display: 'grid', gap: '15px' }}>
            {searchResults.map((result, index) => (
              <div 
                key={index} 
                style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}
              >
                <h3>{result.document_name || 'Untitled Document'}</h3>
                <p style={{ color: '#666', fontSize: '14px' }}>
                  Relevance Score: {result.score ? result.score.toFixed(2) : 'N/A'}
                </p>
                {result.snippet && (
                  <p style={{ marginTop: '10px', padding: '10px', background: '#f5f5f5', borderRadius: '4px' }}>
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
