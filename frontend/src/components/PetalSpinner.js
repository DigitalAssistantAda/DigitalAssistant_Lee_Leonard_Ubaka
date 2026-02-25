import React from 'react';
import petalSrc from '../ada_petal.png';
import './PetalSpinner.css';

/**
 * PetalSpinner – a spinning petal loading indicator.
 *
 * Props:
 *   size     (number)  – pixel size; default 40
 *   page     (bool)    – renders as a full-page loading screen
 *   label    (string)  – optional text below (page mode only)
 */
function PetalSpinner({ size = 40, page = false, label = 'Loading…' }) {
  const spinner = (
    <div className="petal-spinner">
      <img src={petalSrc} alt="Loading" width={size} height={size} />
    </div>
  );

  if (page) {
    return (
      <div className="petal-spinner-page">
        <div className="petal-spinner">
          <img src={petalSrc} alt="Loading" width={64} height={64} />
        </div>
        {label && <span className="petal-spinner-label">{label}</span>}
      </div>
    );
  }

  return spinner;
}

export default PetalSpinner;
