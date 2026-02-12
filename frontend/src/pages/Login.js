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
  const [errorMessages, setErrorMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const buildRegisterErrors = (errorData) => {
    const detail = errorData?.detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => {
        const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
        if (field === 'email') return `Email: ${item.msg}`;
        if (field === 'username') return `Username: ${item.msg}`;
        if (field === 'password') return item.msg;
        return item.msg || 'Invalid registration data.';
      });
    }
    if (typeof detail === 'string' && detail.trim()) {
      return [detail];
    }
    return ['Registration failed. Please check your details and try again.'];
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessages([]);
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
        const errorData = await response.json().catch(() => null);
        if (isRegister) {
          setErrorMessages(buildRegisterErrors(errorData));
        } else {
          setErrorMessages([errorData?.detail || 'Authentication failed']);
        }
        setLoading(false);
        return;
      }

      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      onLogin(data);
    } catch (err) {
      setErrorMessages([err.message || 'Authentication failed']);
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

        {errorMessages.length > 0 && (
          <div className="error-message">
            {errorMessages.length === 1 ? (
              errorMessages[0]
            ) : (
              <ul className="error-list">
                {errorMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
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
