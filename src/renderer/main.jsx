import React from 'react';
import { createRoot } from 'react-dom/client';
import { applyTheme, readAppearance } from './lib/apply-theme.js';
import App from './App.jsx';
import QuickChatApp from './QuickChatApp.jsx';
import './styles.css';

applyTheme(readAppearance());

const WindowApp = new URLSearchParams(window.location.search).get('window') === 'quick-chat'
  ? QuickChatApp
  : App;

document.documentElement.classList.toggle('quick-chat-window', WindowApp === QuickChatApp);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WindowApp />
  </React.StrictMode>,
);
