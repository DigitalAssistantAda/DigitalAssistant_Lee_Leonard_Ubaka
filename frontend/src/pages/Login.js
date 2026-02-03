import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import '../styles/shared.css';

function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const payload = isRegister 
        ? formData 
        : { email_or_username: formData.username, password: formData.password };

      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Authentication failed');
      }

      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <Link to="/" className="back-link">
        <ArrowLeft size={20} />
        <span>Back to Home</span>
      </Link>
      <h1 className="auth-title">{isRegister ? 'Create Account' : 'Welcome Back'}</h1>
      <p className="auth-subtitle">
        {isRegister ? 'Join Ada to organize your knowledge' : 'Sign in to continue to Ada'}
      </p>
      
      <form className="auth-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Username</label>
          <input
            type="text"
            name="username"
            value={formData.username}
            onChange={handleInputChange}
            required
            className="form-input"
            placeholder="Enter your username"
          />
        </div>

        {isRegister && (
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              required
              className="form-input"
              placeholder="Enter your email"
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Password</label>
          <input
            type="password"
            name="password"
            value={formData.password}
            onChange={handleInputChange}
            required
            className="form-input"
            placeholder="Enter your password"
          />
        </div>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <button 
          type="submit" 
          disabled={loading}
          className="btn-primary"
        >
          {loading ? 'Processing...' : (isRegister ? 'Create Account' : 'Sign In')}
        </button>
      </form>

      <div className="auth-toggle">
        {isRegister ? 'Already have an account? ' : "Don't have an account? "}
        <button onClick={() => setIsRegister(!isRegister)}>
          {isRegister ? 'Sign In' : 'Create Account'}
        </button>
      </div>
    </div>
  );
}

export default Login;
