import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './styles/tokens.css';
import './styles/base.css';
import './styles/materials.css';
import './styles/auth.css';
import './styles/shell.css';
import './styles/chat.css';
import './styles/call.css';
import './styles/admin.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
