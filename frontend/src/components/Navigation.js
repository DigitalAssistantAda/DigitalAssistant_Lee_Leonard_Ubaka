import React from 'react';
import { Link } from 'react-router-dom';

function Navigation({ user, onLogout }) {
  return (
    <nav style={{ 
      padding: '15px 20px', 
      background: '#333', 
      color: 'white',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        <Link to="/" style={{ color: 'white', textDecoration: 'none', fontSize: '20px', fontWeight: 'bold' }}>
          Ada
        </Link>
        {user && (
          <>
            <Link to="/dashboard" style={{ color: 'white', textDecoration: 'none' }}>
              Dashboard
            </Link>
            <Link to="/workspaces" style={{ color: 'white', textDecoration: 'none' }}>
              Workspaces
            </Link>
            <Link to="/documents" style={{ color: 'white', textDecoration: 'none' }}>
              Documents
            </Link>
            <Link to="/search" style={{ color: 'white', textDecoration: 'none' }}>
              Search
            </Link>
            <Link to="/summaries" style={{ color: 'white', textDecoration: 'none' }}>
              Summaries
            </Link>
          </>
        )}
      </div>
      {user && (
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <span>Welcome, {user.username}</span>
          <button 
            onClick={onLogout}
            style={{ 
              padding: '8px 16px', 
              cursor: 'pointer',
              background: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px'
            }}
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}

export default Navigation;
