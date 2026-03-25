import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { parseApiErrorMessage } from '../utils/apiError';
import adaLogo from '../ada_logo.png';
import './Login.css';

function Login({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errorMessages, setErrorMessages] = useState([]);
  const [loading, setLoading] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  useEffect(() => {
    setErrorMessages([]);
    setShowPassword(false);
  }, [isRegister]);

  const handleForgotPassword = () => {
    setErrorMessages([
      'Password reset is not configured yet. Please contact your workspace administrator.',
    ]);
  };

  const getValidationDetails = (errorData) => {
    if (Array.isArray(errorData?.error?.details)) {
      return errorData.error.details;
    }
    if (Array.isArray(errorData?.detail)) {
      return errorData.detail;
    }
    return [];
  };

  const buildRegisterErrors = (errorData) => {
    const validationDetails = getValidationDetails(errorData);
    if (validationDetails.length > 0) {
      return validationDetails.map((item) => {
        const field = item.field || (Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null);
        const message = item.message || item.msg || 'Invalid value.';
        if (field === 'email') return `Email: ${message}`;
        if (field === 'username') return `Username: ${message}`;
        if (field === 'password') return `Password: ${message}`;
        return message;
      });
    }

    const errorCode = errorData?.error?.code;
    if (errorCode === 'EMAIL_ALREADY_EXISTS') return ['Email: An account with this email already exists.'];
    if (errorCode === 'USERNAME_ALREADY_EXISTS') return ['Username: This username is already taken.'];

    const apiMessage = parseApiErrorMessage(errorData, null);
    if (apiMessage) {
      return [apiMessage];
    }
    return ['Registration failed. Please check your details and try again.'];
  };

  const buildLoginErrors = (errorData) => {
    const validationDetails = getValidationDetails(errorData);
    if (validationDetails.length > 0) {
      return validationDetails.map((item) => {
        const field = item.field || (Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null);
        const message = item.message || item.msg || 'Invalid value.';
        if (field === 'email_or_username') return `Email or Username: ${message}`;
        if (field === 'password') return `Password: ${message}`;
        return message;
      });
    }

    const errorCode = errorData?.error?.code;
    if (errorCode === 'USER_NOT_FOUND') return ['No account found for that email or username.'];
    if (errorCode === 'INVALID_PASSWORD') return ['Password is incorrect.'];
    if (errorCode === 'ACCOUNT_INACTIVE') return ['Your account is inactive. Contact your workspace administrator.'];
    if (errorCode === 'RATE_LIMITED') return ['Too many attempts. Please wait and try again.'];

    const apiMessage = parseApiErrorMessage(errorData, null);
    if (apiMessage) return [apiMessage];
    return ['Authentication failed. Please check your credentials and try again.'];
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessages([]);
    setLoading(true);

    try {
      const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const payload = isRegister 
        ? formData 
        : { email_or_username: formData.username, password: formData.password, remember_me: rememberMe };

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
          setErrorMessages(buildLoginErrors(errorData));
        }
        setLoading(false);
        return;
      }

      const data = await response.json();
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token);
      }

      if (!isRegister && rememberMe) {
        localStorage.setItem('persist_session', 'true');
      } else {
        localStorage.removeItem('persist_session');
        sessionStorage.setItem('session_active', 'true');
      }

      onLogin(data);
    } catch (err) {
      setErrorMessages([err.message || 'Authentication failed']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <aside className="login-brand-panel">
          <div className="login-brand-header">
            <span className="login-brand-name">Ada</span>
          </div>

          <div className="login-brand-center" aria-hidden="true">
            <div className="login-flower-ring">
              <img src={adaLogo} alt="" className="login-brand-flower" />
            </div>
          </div>

          <div className="login-brand-footer">
            <p className="login-brand-quote">
              The <em>warmest</em> way to find what your team already knows.
            </p>
            <div className="login-brand-trust">
              <span className="login-trust-dot" />
              Built for secure internal knowledge workflows.
            </div>
          </div>
        </aside>

        <section className="login-form-panel">
          <div className="login-panel-top">
            <Link to="/" className="login-back-link">
              <ArrowLeft size={18} />
              <span>Back to Home</span>
            </Link>
          </div>

          <header className="login-form-header">
            <h1>{isRegister ? 'Join us' : 'Welcome back'}</h1>
            <p>
              {isRegister
                ? 'Set up your team\'s private knowledge hub.'
                : 'Enter your credentials to access your workspace.'}
            </p>
          </header>

          <form className="login-form-body" onSubmit={handleSubmit}>
            <div className="login-field-group">
              <div className="login-input-wrapper">
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  required
                  className="login-input"
                  placeholder={isRegister ? 'Username' : 'Email or Username'}
                  autoComplete={isRegister ? 'username' : 'username'}
                />
              </div>

              {isRegister && (
                <div className="login-input-wrapper">
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    className="login-input"
                    placeholder="Work Email"
                    autoComplete="email"
                  />
                </div>
              )}

              <div className="login-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  className="login-input login-input-password"
                  placeholder={isRegister ? 'Create password' : 'Password'}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  className="login-input-toggle"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {!isRegister && (
              <div className="login-meta-row">
                <label className="login-checkbox-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                  />
                  <span>Remember me</span>
                </label>
                <button type="button" className="login-meta-link" onClick={handleForgotPassword}>Forgot password?</button>
              </div>
            )}

            {errorMessages.length > 0 && (
              <div className="login-error-message">
                {errorMessages.length === 1 ? (
                  errorMessages[0]
                ) : (
                  <ul>
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
              className="login-submit-btn"
            >
              <span>{loading ? 'Processing...' : (isRegister ? 'Create Account' : 'Sign In')}</span>
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <footer className="login-footer">
            <p>
              {isRegister ? 'Already have an account?' : "Don't have an account?"}
            </p>
            <button type="button" onClick={() => setIsRegister(!isRegister)}>
              {isRegister ? 'Sign In' : 'Create Account'}
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

export default Login;
