/**
 * Design — which look everyone gets.
 *
 * Picking a card previews it on this screen only; "Apply to everyone" saves it
 * and every open app switches at once (server/src/services/design.js emits
 * app:design). Leaving the tab without applying puts the live design back, so
 * a preview can never quietly become someone else's problem.
 *
 * The thumbnails use fixed colours rather than tokens: each has to show its
 * own design while the page around it is showing another.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Logo from '@/components/Logo';
import { IconCheck } from '@/components/Icon';
import { adminGet, adminPut } from '@/lib/adminApi';
import { DESIGNS, applyDesign, useDesign, type DesignId } from '@/lib/design';
import { popFrom, springs } from '@/lib/motion';

interface Look {
  bg: string;
  surface: string;
  ink: string;
  mine: string;
  mineInk: string;
  theirs: string;
  primary: string;
  onPrimary: string;
}

/** A light and a dark swatch per design — the same values tokens.css uses. */
const LOOKS: Record<DesignId, { font: string; radius: number; light: Look; dark: Look }> = {
  'midnight-pebble': {
    font: "'Fredoka', sans-serif",
    radius: 14,
    dark: { bg: '#0E0D14', surface: '#18161F', ink: '#F4F2FA', mine: '#C8F545', mineInk: '#0E0D14', theirs: '#22202C', primary: '#C8F545', onPrimary: '#0E0D14' },
    light: { bg: '#F4F2FB', surface: '#FFFFFF', ink: '#1F1B2E', mine: '#C8F545', mineInk: '#1F1B2E', theirs: '#FFFFFF', primary: '#5443D6', onPrimary: '#FFFFFF' },
  },
  calm: {
    font: "'Instrument Serif', Georgia, serif",
    radius: 11,
    dark: { bg: '#141317', surface: '#1C1B20', ink: '#F3F1EE', mine: '#F0754E', mineInk: '#141317', theirs: '#26242B', primary: '#F0754E', onPrimary: '#141317' },
    light: { bg: '#FAF8F5', surface: '#FFFFFF', ink: '#18171C', mine: '#C4421D', mineInk: '#FFFFFF', theirs: '#F1EEE9', primary: '#C4421D', onPrimary: '#FFFFFF' },
  },
  midnight: {
    font: "'Space Grotesk', sans-serif",
    radius: 8,
    dark: { bg: '#0D0E11', surface: '#15171C', ink: '#F3F4F6', mine: '#C8F545', mineInk: '#0D0E11', theirs: '#1F2229', primary: '#C8F545', onPrimary: '#0D0E11' },
    light: { bg: '#F5F6F8', surface: '#FFFFFF', ink: '#0D0E11', mine: '#C8F545', mineInk: '#0D0E11', theirs: '#FFFFFF', primary: '#0D0E11', onPrimary: '#C8F545' },
  },
  pebble: {
    font: "'Fredoka', sans-serif",
    radius: 14,
    dark: { bg: '#16131F', surface: '#1E1A2A', ink: '#F3F0FF', mine: '#8B7CFF', mineInk: '#16131F', theirs: '#28233A', primary: '#8B7CFF', onPrimary: '#16131F' },
    light: { bg: '#F4F2FB', surface: '#FFFFFF', ink: '#1F1B2E', mine: '#5443D6', mineInk: '#FFFFFF', theirs: '#FFFFFF', primary: '#5443D6', onPrimary: '#FFFFFF' },
  },
};

function Thumb({ look, radius }: { look: Look; radius: number }) {
  return (
    <div className="design-thumb" style={{ background: look.bg, color: look.ink }}>
      <span className="design-thumb-bubble" style={{ background: look.theirs, borderRadius: radius }} />
      <span
        className="design-thumb-bubble mine"
        style={{ background: look.mine, borderRadius: radius, color: look.mineInk }}
      />
      <span className="design-thumb-button" style={{ background: look.primary, color: look.onPrimary }} />
    </div>
  );
}

export default function Designs() {
  const live = useDesign((s) => s.design);
  const [current, setCurrent] = useState<DesignId | null>(null);
  const [picked, setPicked] = useState<DesignId | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    adminGet<{ design: DesignId }>('/design')
      .then((r) => {
        setCurrent(r.design);
        setPicked(r.design);
      })
      .catch(() => setMessage('Could not read the current design.'));
  }, []);

  // A preview is this screen's alone: leaving puts the live design back.
  useEffect(
    () => () => {
      const saved = useDesign.getState().design;
      adminGet<{ design: DesignId }>('/design')
        .then((r) => r.design !== saved && applyDesign(r.design))
        .catch(() => {});
    },
    []
  );

  const preview = (id: DesignId) => {
    setPicked(id);
    setState('idle');
    applyDesign(id);
  };

  const apply = async () => {
    if (!picked) return;
    setState('saving');
    try {
      const r = await adminPut<{ design: DesignId }>('/design', { design: picked });
      setCurrent(r.design);
      setState('saved');
      setMessage(`Everyone is now on ${DESIGNS.find((d) => d.id === r.design)?.name}.`);
    } catch (e: any) {
      setState('error');
      setMessage(e?.message || 'Could not switch the design.');
    }
  };

  const changed = picked && current && picked !== current;

  return (
    <section className="admin-panel design-panel">
      <p className="design-intro">
        Choose how Nook looks for everyone. Tap a design to preview it on this screen, then apply it — every open app
        switches straight away, and each person keeps their own light or dark setting and accent colour.
      </p>

      <div className="design-grid" role="radiogroup" aria-label="Design">
        {DESIGNS.map((d, i) => {
          const look = LOOKS[d.id];
          const on = picked === d.id;
          return (
            <motion.button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`design-card${on ? ' on' : ''}`}
              onClick={() => preview(d.id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: i * 0.05 }}
              whileTap={{ scale: 0.97 }}
            >
              <div className="design-thumbs">
                <Thumb look={look.dark} radius={look.radius} />
                <Thumb look={look.light} radius={look.radius} />
              </div>
              <div className="design-card-foot">
                <Logo design={d.id} size={36} />
                <div className="design-card-text">
                  <strong style={{ fontFamily: look.font }}>{d.name}</strong>
                  <span>{d.tagline}</span>
                </div>
                <AnimatePresence>
                  {current === d.id && (
                    <motion.span className="design-live" variants={popFrom()} initial="hidden" animate="show" exit="exit">
                      Live
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              {on && <motion.span layoutId="design-ring" className="design-ring" transition={springs.pop} />}
            </motion.button>
          );
        })}
      </div>

      <div className="design-actions">
        <button className="slab" onClick={apply} disabled={!changed || state === 'saving'}>
          {state === 'saving' ? 'Switching everyone…' : changed ? `Apply ${DESIGNS.find((d) => d.id === picked)?.name} to everyone` : 'This design is live'}
        </button>
        <AnimatePresence mode="wait">
          {message && (
            <motion.span
              key={message}
              className={`design-note${state === 'error' ? ' error' : ''}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {state === 'saved' && <IconCheck size={16} />} {message}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {live !== current && current && (
        <p className="design-preview-note">Previewing on this screen only — nobody else sees it until you apply.</p>
      )}
    </section>
  );
}
