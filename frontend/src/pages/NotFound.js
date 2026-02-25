import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import adaPetal from '../ada_petal.png';
import './NotFound.css';

function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="not-found-page">
      <img src={adaPetal} alt="" className="not-found-petal" aria-hidden="true" />

      <p className="not-found-code">
        4<span>0</span>4
      </p>

      <h1 className="not-found-title">This petal drifted away</h1>

      <p className="not-found-sub">
        The page you're looking for doesn't exist or may have been moved.
      </p>

      <div className="not-found-actions">
        <Link to="/dashboard" className="not-found-btn primary">
          Go home
        </Link>
        <button
          className="not-found-btn secondary"
          onClick={() => navigate(-1)}
        >
          Go back
        </button>
      </div>
    </div>
  );
}

export default NotFound;
