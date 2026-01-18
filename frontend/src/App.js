import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [healthStatus, setHealthStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    checkHealth();
  }, []);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_URL}/health`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      setHealthStatus(data);
    } catch (err) {
      setError(err.message);
      console.error('Error checking health:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Ada</h1>
        
        <div className="health-check">
          <h2>Backend Health Status</h2>
          
          {loading && <p>Checking backend health...</p>}
          
          {error && (
            <div className="error">
              <p> Error: {error}</p>
              <p>Make sure the backend is running at {API_URL}</p>
            </div>
          )}
          
          {healthStatus && (
            <div className="success">
              <p> Status: {healthStatus.status}</p>
              <p>Message: {healthStatus.message}</p>
            </div>
          )}
          
          <button onClick={checkHealth} disabled={loading}>
            {loading ? 'Checking...' : 'Refresh Health Check'}
          </button>
        </div>
      </header>
    </div>
  );
}

export default App;
