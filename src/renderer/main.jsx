import React from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, readAppearance } from './lib/apply-theme.js';
import App from './App.jsx';
import './styles.css';

applyTheme(readAppearance());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
