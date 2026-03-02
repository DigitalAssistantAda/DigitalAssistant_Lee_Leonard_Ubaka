import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import adaPetal from '../ada_petal.png';
import './AccessState.css';

function AccessState({
  title = 'Workspace unavailable',
  message = 'This workspace does not exist or you do not have access to it.',
  primaryLabel = 'Go to Workspaces',
  primaryTo = '/workspace',
  showBack = true,
  compact = false,
}) {
  const navigate = useNavigate();

  return (
    <div className={`access-state ${compact ? 'access-state-compact' : ''}`}>
      <img src={adaPetal} alt="" className="access-state-petal" aria-hidden="true" />

      <p className="access-state-code">
        4<span>0</span>4
      </p>

      <h2 className="access-state-title">{title}</h2>
      <p className="access-state-sub">{message}</p>

      <div className="access-state-actions">
        <Link to={primaryTo} className="access-state-btn primary">
          {primaryLabel}
        </Link>
        {showBack && (
          <button
            type="button"
            className="access-state-btn secondary"
            onClick={() => navigate(-1)}
          >
            Go back
          </button>
        )}
      </div>
    </div>
  );
}

export default AccessState;
