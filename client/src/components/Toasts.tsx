import { motion, AnimatePresence } from 'framer-motion';
import { useUi } from '@/stores/ui';
import { spring } from '@/lib/motion';
import { IconCheck, IconWarning } from './Icon';

export default function Toasts() {
  const { toasts, dropToast } = useUi();

  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            className={`toast${t.bad ? ' bad' : ''}`}
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={spring}
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
