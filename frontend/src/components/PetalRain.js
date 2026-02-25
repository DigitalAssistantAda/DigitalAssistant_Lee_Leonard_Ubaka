import React, { useEffect, useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import petalSrc from '../ada_petal.png';
import './PetalRain.css';

/**
 * PetalRain – global petal animation overlay.
 *
 * Exposes ref methods:
 *   rain(count?)       – shower of petals falling from the top
 *   burst(x, y, count?) – explosion of petals from a specific point
 *   float(x, y, count?) – petals floating upward from a point (login bg)
 *
 * Also listens for global window events:
 *   'ada:petalrain'   – triggers rain()
 *   'ada:petalburst'  – triggers burst(detail.x, detail.y, detail.count?)
 *   'ada:petalfloat'  – triggers float(detail.x, detail.y, detail.count?)
 */
const PetalRain = forwardRef((props, ref) => {
  const containerRef = useRef(null);

  const spawnPetal = useCallback((x, y, mode = 'fall', maxX) => {
    if (!containerRef.current) return;

    const el = document.createElement('div');
    el.className = `ada-petal ada-petal--${mode}`;

    const isBurst = mode === 'burst';
    const isFloat = mode === 'float';
    const size = isBurst
      ? 10 + Math.random() * 18
      : isFloat
      ? 14 + Math.random() * 22
      : 16 + Math.random() * 26;

    const spin = (Math.random() > 0.5 ? 1 : -1) * (90 + Math.random() * 360);

    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.setProperty('--spin', `${spin}deg`);

    if (isBurst) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 200;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.setProperty('--vx', `${Math.cos(angle) * speed}px`);
      el.style.setProperty('--vy', `${Math.sin(angle) * speed}px`);
      el.style.animationDuration = `${0.5 + Math.random() * 0.7}s`;
    } else if (isFloat) {
      const drift = (Math.random() - 0.5) * 100;
      const rise = 80 + Math.random() * 160;
      el.style.left = `${(x ?? Math.random() * window.innerWidth) + (Math.random() - 0.5) * 120}px`;
      el.style.top = `${y ?? window.innerHeight * 0.8}px`;
      el.style.setProperty('--rise', `-${rise}px`);
      el.style.setProperty('--drift', `${drift}px`);
      el.style.animationDuration = `${1.5 + Math.random() * 2}s`;
      el.style.animationDelay = `${Math.random() * 0.6}s`;
    } else {
      const drift = (Math.random() - 0.5) * 100;
      const spawnWidth = maxX || window.innerWidth;
      el.style.left = `${Math.random() * spawnWidth}px`;
      el.style.top = `${-size - 5}px`;
      el.style.setProperty('--drift', `${drift}px`);
      el.style.animationDuration = `${2 + Math.random() * 3}s`;
      el.style.animationDelay = `${Math.random() * 0.3}s`;
    }

    const img = document.createElement('img');
    img.src = petalSrc;
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);

    containerRef.current.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, []);

  // ── Public API ──────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    rain(count = 40) {
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnPetal(undefined, undefined, 'fall'), i * 55);
      }
    },
    burst(x, y, count = 24) {
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnPetal(x, y, 'burst'), i * 12);
      }
    },
    float(x, y, count = 16) {
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnPetal(x, y, 'float'), i * 80);
      }
    },
  }));

  // ── Global event bus ────────────────────────────────────────────
  useEffect(() => {
    const onRain = (e) => {
      const { maxX, count: cnt = 40 } = e?.detail || {};
      for (let i = 0; i < cnt; i++) {
        setTimeout(() => spawnPetal(undefined, undefined, 'fall', maxX), i * 55);
      }
    };
    const onBurst = (e) => {
      const { x = window.innerWidth / 2, y = window.innerHeight / 2, count = 24 } = e.detail || {};
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnPetal(x, y, 'burst'), i * 12);
      }
    };
    const onFloat = (e) => {
      const { x, y, count = 16 } = e.detail || {};
      for (let i = 0; i < count; i++) {
        setTimeout(() => spawnPetal(x, y, 'float'), i * 80);
      }
    };

    window.addEventListener('ada:petalrain', onRain);
    window.addEventListener('ada:petalburst', onBurst);
    window.addEventListener('ada:petalfloat', onFloat);
    return () => {
      window.removeEventListener('ada:petalrain', onRain);
      window.removeEventListener('ada:petalburst', onBurst);
      window.removeEventListener('ada:petalfloat', onFloat);
    };
  }, [spawnPetal]);

  return (
    <div
      ref={containerRef}
      className="ada-petal-rain-container"
      aria-hidden="true"
    />
  );
});

PetalRain.displayName = 'PetalRain';
export default PetalRain;
