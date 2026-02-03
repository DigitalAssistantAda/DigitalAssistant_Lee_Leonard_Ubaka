import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';

import Navigation from './components/Navigation';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Workspaces from './pages/Workspaces';
import WorkspaceDetail from './pages/WorkspaceDetail';
import WorkspaceSettings from './pages/WorkspaceSettings';
import WorkspaceIssues from './pages/WorkspaceIssues';
import Documents from './pages/Documents';
import Search from './pages/Search';
import Summaries from './pages/Summaries';
import AIAssistant from './pages/AIAssistant';

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    // Fetch current user from /me endpoint
    const fetchCurrentUser = async () => {
      const token = localStorage.getItem('token');
      
      if (token) {
        try {
          const response = await fetch(`${API_URL}/api/v1/auth/me`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            const userData = await response.json();
            setUser(userData);
            localStorage.setItem('user', JSON.stringify(userData));
          } else {
            // Token invalid, clear it
            localStorage.removeItem('token');
            localStorage.removeItem('user');
          }
        } catch (err) {
          console.error('Error fetching user:', err);
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      
      setLoading(false);
    };
    
    fetchCurrentUser();
  }, [API_URL]);

  const handleLogin = (data) => {
    setUser(data.user);
  };

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem('token');
      if (token) {
        // Call backend logout endpoint
        await fetch('http://localhost:8000/api/v1/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      // Clear local storage regardless of API call success
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setUser(null);
    }
  };

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading...</div>;
  }

  return (
    <Router>
      <div className="App">
        <Navigation user={user} onLogout={handleLogout} />
        
        <Routes>
          <Route 
            path="/" 
            element={user ? <Navigate to="/dashboard" /> : <Landing />} 
          />
          <Route 
            path="/login" 
            element={user ? <Navigate to="/dashboard" /> : <Login onLogin={handleLogin} />} 
          />
          <Route 
            path="/dashboard" 
            element={user ? <Dashboard /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace" 
            element={user ? <Workspaces /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace/:id" 
            element={user ? <WorkspaceDetail /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace/:id/settings" 
            element={user ? <WorkspaceSettings onClose={() => window.history.back()} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/workspace/:id/issues" 
            element={user ? <WorkspaceIssues /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/documents" 
            element={user ? <Documents /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/search" 
            element={user ? <Search /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/summaries" 
            element={user ? <Summaries /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/ai-assistant" 
            element={user ? <AIAssistant /> : <Navigate to="/login" />} 
          />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
