import React from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';

import './styles/tokens.css';
import './styles/base.css';
import './styles/materials.css';
import './styles/auth.css';
import './styles/shell.css';
import './styles/chat.css';
import './styles/call.css';
import './styles/admin.css';

/**
 * A theme switch fades rather than flashes — but only for a moment.
 *
 * A permanent `transition: background, color` on everything would make every
 * hover and every re-render pay for it, and would animate things that should
 * snap. So the class lives on <html> for the length of the fade and no
 * longer; base.css scopes the transition to it. Watching the attribute rather
 * than hooking setTheme catches every route in, including the OS flipping
 * to dark while Nook is open on 'system'.
 */
let themeTimer: number | undefined;
new MutationObserver((records) => {
  const root = document.documentElement;
  // applyTheme rewrites the attribute on every settings save; only a real
  // change is worth a fade.
  if (!records.some((r) => r.oldValue !== root.dataset.theme)) return;
  root.classList.add('theme-changing');
  window.clearTimeout(themeTimer);
  themeTimer = window.setTimeout(() => root.classList.remove('theme-changing'), 320);
}).observe(document.documentElement, { attributes: true, attributeOldValue: true, attributeFilter: ['data-theme'] });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* "user": Framer drops transform and layout animation for anyone who asked
        the OS for reduced motion, keeping only fades — the JS half of the
        rule base.css applies to CSS animation. */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>
);
