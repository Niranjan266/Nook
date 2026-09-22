import { motion, AnimatePresence } from 'framer-motion';
import { useUi } from '@/stores/ui';
import { toastDrop, springs } from '@/lib/motion';
import { IconCheck, IconWarning } from './Icon';

export default function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dropToast = useUi((s) => s.dropToast);

  return (
    // Dropped in from the top, where the eye already goes for news, and
    // clear of the composer and the phone's bottom bar.
    <div className="toasts" role="status" aria-live="polite">
      {/* popLayout: a leaving toast stops taking space at once, so the others
          slide into place alongside its exit instead of after it. */}
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            className={`toast${t.bad ? ' bad' : ''}`}
            variants={toastDrop}
            initial="hidden"
            animate="show"
            exit="exit"
            transition={{ layout: springs.gentle }}
            onClick={() => dropToast(t.id)}
            layout
          >
            {t.bad ? <IconWarning size={16} /> : <IconCheck size={16} />}
            {t.text}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
