import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Universal safeguard: Ensure OffscreenCanvas has getBoundingClientRect to prevent canvas-confetti errors
if (typeof OffscreenCanvas !== 'undefined' && !('getBoundingClientRect' in OffscreenCanvas.prototype)) {
  (OffscreenCanvas.prototype as any).getBoundingClientRect = function () {
    return {
      top: 0,
      left: 0,
      right: this.width || 0,
      bottom: this.height || 0,
      width: this.width || 0,
      height: this.height || 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
