import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

function Dashboard() {
  const [stats, setStats] = useState({
    workspaces: 0,
    documents: 0,
    recentActivity: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('No authentication token found');
      }

      // Fetch workspaces
      const workspacesResponse = await fetch(`${API_URL}/api/v1/workspaces`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (workspacesResponse.ok) {
        const workspacesData = await workspacesResponse.json();
        setStats(prev => ({ ...prev, workspaces: workspacesData.length }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>Dashboard</h1>

      {loading && <p>Loading dashboard data...</p>}
      
      {error && (
        <div style={{ color: 'red', padding: '10px', marginBottom: '20px' }}>
          Error: {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Workspaces</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.workspaces}</p>
          <Link to="/workspaces">Manage Workspaces</Link>
        </div>

        <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>Documents</h3>
          <p style={{ fontSize: '24px', fontWeight: 'bold' }}>{stats.documents}</p>
          <Link to="/documents">View Documents</Link>
        </div>
      </div>

      <div style={{ marginTop: '30px' }}>
        <h2>Quick Actions</h2>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Link to="/workspaces" style={{ padding: '10px 20px', background: '#007bff', color: 'white', textDecoration: 'none', borderRadius: '4px' }}>
            Create Workspace
          </Link>
          <Link to="/documents" style={{ padding: '10px 20px', background: '#28a745', color: 'white', textDecoration: 'none', borderRadius: '4px' }}>
            Upload Document
          </Link>
          <Link to="/search" style={{ padding: '10px 20px', background: '#17a2b8', color: 'white', textDecoration: 'none', borderRadius: '4px' }}>
            Search Documents
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
