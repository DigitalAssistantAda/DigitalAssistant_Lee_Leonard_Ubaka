import React from 'react';
import PetalSpinner from './PetalSpinner';
import './LoadingState.css';

function LoadingState({ message = 'Loading...', className = '', size = 40 }) {
  const classes = ['ada-loading-state', className].filter(Boolean).join(' ');

  return (
    <div className={classes} role="status" aria-live="polite">
      <PetalSpinner size={size} />
      {message ? <p className="ada-loading-message">{message}</p> : null}
    </div>
  );
}

export default LoadingState;
