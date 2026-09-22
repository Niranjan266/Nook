import { motion, AnimatePresence } from 'framer-motion';
import { useUi } from '@/stores/ui';
import { toastIn, spring } from '@/lib/motion';
import { IconCheck, IconWarning } from './Icon';

export default function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dropToast = useUi((s) => s.dropToast);

  return (
    <div className="toasts" role="status" aria-live="polite">
      {/* popLayout: a leaving toast stops taking space at once, so the others
          slide into place alongside its exit instead of after it. */}
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            className={`toast${t.bad ? ' bad' : ''}`}
            variants={toastIn}
            initial="hidden"
            animate="show"
            exit="exit"
            transition={{ layout: spring }}
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
