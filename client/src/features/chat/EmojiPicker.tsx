import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { spring } from '@/lib/motion';
import { IconSearch, IconClock, IconClose } from '@/components/Icon';

/**
 * The emoji picker.
 *
 * The old one was forty emoji in an eight-column grid inside the attach menu,
 * with a hardcoded 300px width and a fixed left offset. Three things were
 * wrong with it, and only the first is cosmetic:
 *
 *  - the buttons were about 30px, well under the 44px minimum for a touch
 *    target, packed with a 2px gap — so on a phone you hit the wrong face;
 *  - the fixed width and offset overflowed the panel on narrow screens, which
 *    is why emoji appeared spilling outside its rounded edge;
 *  - forty emoji with no search and no categories means the one you want is
 *    usually not there at all.
 *
 * This is a proper picker: categories, search by name, a recently-used row
 * that learns, 44px targets, and full keyboard control. It renders through a
 * portal for the same reason the snap camera does — `.composer` sets
 * `backdrop-filter`, which traps `position: fixed` descendants, and
 * `.surface` clips anything that escapes.
 */

interface Group {
  id: string;
  label: string;
  icon: string;
  emoji: [string, string][];
}

/**
 * Names are for searching, not display. Kept short and plural-free so a single
 * `includes` does the work — a fuzzy matcher would be more clever and much
 * harder to predict when you are typing one letter at a time.
 */
const GROUPS: Group[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emoji: [
      ['😀', 'grin smile happy'], ['😃', 'smile happy open'], ['😄', 'smile laugh happy'],
      ['😁', 'beam grin happy'], ['😆', 'laugh squint haha'], ['😅', 'sweat laugh nervous'],
      ['🤣', 'rofl laugh floor'], ['😂', 'joy tears laugh cry'], ['🙂', 'slight smile'],
      ['🙃', 'upside down silly'], ['😉', 'wink'], ['😊', 'blush smile warm'],
      ['😇', 'halo angel innocent'], ['🥰', 'love hearts adore'], ['😍', 'heart eyes love'],
      ['🤩', 'star struck wow'], ['😘', 'kiss blow'], ['😗', 'kiss'], ['😚', 'kiss closed'],
      ['😋', 'yum tongue tasty'], ['😛', 'tongue'], ['😜', 'wink tongue silly'],
      ['🤪', 'zany goofy wild'], ['🤗', 'hug'], ['🤭', 'giggle oops'], ['🤔', 'think hmm'],
      ['🤐', 'zipper quiet secret'], ['😐', 'neutral flat'], ['😑', 'expressionless'],
      ['😶', 'no mouth blank'], ['😏', 'smirk'], ['😒', 'unamused meh'],
      ['🙄', 'eye roll'], ['😬', 'grimace awkward'], ['😴', 'sleep zzz tired'],
      ['🥱', 'yawn tired bored'], ['😌', 'relieved calm'], ['😔', 'pensive sad'],
      ['😪', 'sleepy tear'], ['🤤', 'drool'], ['😷', 'mask sick'], ['🤒', 'sick fever'],
      ['🥳', 'party celebrate birthday'], ['🥺', 'pleading please puppy'],
      ['😢', 'cry sad tear'], ['😭', 'sob cry loud'], ['😤', 'huff steam angry'],
      ['😠', 'angry mad'], ['😡', 'rage furious'], ['🤯', 'mind blown explode'],
      ['😳', 'flushed shock'], ['🥵', 'hot heat'], ['🥶', 'cold freeze'],
      ['😱', 'scream fear shock'], ['😨', 'fear anxious'], ['😰', 'anxious sweat'],
      ['🤠', 'cowboy'], ['😎', 'cool sunglasses'], ['🤓', 'nerd glasses'],
      ['🧐', 'monocle inspect'], ['🥹', 'holding back tears touched'],
    ],
  },
  {
    id: 'gestures',
    label: 'People',
    icon: '👋',
    emoji: [
      ['👋', 'wave hello bye'], ['🤚', 'raised hand'], ['✋', 'hand stop'], ['🖐', 'hand fingers'],
      ['👌', 'ok perfect'], ['🤌', 'pinched italian'], ['🤏', 'small pinch'], ['✌️', 'peace victory'],
      ['🤞', 'crossed fingers luck'], ['🤟', 'love you'], ['🤘', 'rock horns'], ['🤙', 'call me shaka'],
      ['👈', 'point left'], ['👉', 'point right'], ['👆', 'point up'], ['👇', 'point down'],
      ['👍', 'thumbs up yes good like'], ['👎', 'thumbs down no bad'], ['✊', 'fist'],
      ['👊', 'punch bump'], ['👏', 'clap applause'], ['🙌', 'raise hands praise'],
      ['🤝', 'handshake deal'], ['🙏', 'pray thanks please'], ['💪', 'muscle strong'],
      ['🫶', 'heart hands love'], ['🤲', 'palms up'], ['✍️', 'write'],
      ['💅', 'nails'], ['🤳', 'selfie'], ['👀', 'eyes look'], ['🧠', 'brain'],
      ['👶', 'baby'], ['🧑', 'person'], ['👩', 'woman'], ['👨', 'man'],
      ['🧓', 'older person'], ['👮', 'police'], ['🕵️', 'detective'], ['👷', 'worker'],
      ['🤴', 'prince'], ['👸', 'princess'], ['🦸', 'superhero'], ['🎅', 'santa'],
      ['🤰', 'pregnant'], ['🧑‍🍳', 'cook chef'], ['🧑‍⚕️', 'doctor nurse'], ['🧑‍🎓', 'student graduate'],
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emoji: [
      ['❤️', 'red heart love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'],
      ['💚', 'green heart'], ['💙', 'blue heart'], ['💜', 'purple heart'],
      ['🖤', 'black heart'], ['🤍', 'white heart'], ['🤎', 'brown heart'],
      ['💔', 'broken heart'], ['❣️', 'heart exclamation'], ['💕', 'two hearts'],
      ['💞', 'revolving hearts'], ['💓', 'beating heart'], ['💗', 'growing heart'],
      ['💖', 'sparkling heart'], ['💘', 'cupid arrow'], ['💝', 'heart gift'],
      ['💟', 'heart decoration'], ['♥️', 'heart suit'], ['💋', 'kiss lips'],
      ['💯', 'hundred perfect'], ['💢', 'anger'], ['💥', 'boom collision'],
      ['💫', 'dizzy star'], ['💦', 'sweat water'], ['💨', 'dash wind'],
      ['🔥', 'fire lit hot'], ['✨', 'sparkles shine'], ['⭐', 'star'],
      ['🌟', 'glowing star'], ['⚡', 'lightning fast'], ['🎉', 'party popper celebrate'],
      ['🎊', 'confetti'], ['🎈', 'balloon'], ['🎁', 'gift present'], ['🏆', 'trophy win'],
      ['🥇', 'gold medal first'], ['🎯', 'target bullseye'], ['🎵', 'music note'],
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '🌿',
    emoji: [
      ['🐶', 'dog puppy'], ['🐱', 'cat kitten'], ['🐭', 'mouse'], ['🐹', 'hamster'],
      ['🐰', 'rabbit bunny'], ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'],
      ['🐨', 'koala'], ['🐯', 'tiger'], ['🦁', 'lion'], ['🐮', 'cow'],
      ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'], ['🐔', 'chicken'],
      ['🐧', 'penguin'], ['🐦', 'bird'], ['🦆', 'duck'], ['🦉', 'owl'],
      ['🐝', 'bee'], ['🦋', 'butterfly'], ['🐢', 'turtle'], ['🐙', 'octopus'],
      ['🐳', 'whale'], ['🐬', 'dolphin'], ['🐴', 'horse'], ['🦄', 'unicorn'],
      ['🌸', 'blossom flower'], ['🌷', 'tulip'], ['🌹', 'rose'], ['🌻', 'sunflower'],
      ['🌼', 'daisy flower'], ['🌱', 'seedling sprout'], ['🌿', 'herb leaf'],
      ['🍀', 'clover luck'], ['🍁', 'maple leaf autumn'], ['🌳', 'tree'],
      ['🌵', 'cactus'], ['🌊', 'wave ocean'], ['☀️', 'sun sunny'], ['🌤', 'sun cloud'],
      ['☁️', 'cloud'], ['🌧', 'rain'], ['⛈', 'storm thunder'], ['❄️', 'snow cold'],
      ['🌈', 'rainbow'], ['🌙', 'moon night'], ['🌚', 'new moon face'], ['🪐', 'planet saturn'],
    ],
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍕',
    emoji: [
      ['☕', 'coffee tea hot'], ['🍵', 'tea green'], ['🧋', 'boba bubble tea'],
      ['🥤', 'soda drink'], ['🍺', 'beer'], ['🍻', 'cheers beers'], ['🍷', 'wine'],
      ['🥂', 'champagne cheers'], ['🍾', 'bottle celebrate'], ['🍕', 'pizza'],
      ['🍔', 'burger'], ['🍟', 'fries chips'], ['🌭', 'hotdog'], ['🌮', 'taco'],
      ['🌯', 'burrito wrap'], ['🍜', 'noodles ramen'], ['🍝', 'pasta spaghetti'],
      ['🍣', 'sushi'], ['🍱', 'bento'], ['🍚', 'rice'], ['🍛', 'curry'],
      ['🥗', 'salad'], ['🍞', 'bread'], ['🥐', 'croissant'], ['🧀', 'cheese'],
      ['🥚', 'egg'], ['🍳', 'cooking fry'], ['🥞', 'pancakes'], ['🍰', 'cake slice'],
      ['🎂', 'birthday cake'], ['🧁', 'cupcake'], ['🍩', 'donut'], ['🍪', 'cookie'],
      ['🍫', 'chocolate'], ['🍬', 'candy sweet'], ['🍦', 'ice cream'],
      ['🍎', 'apple'], ['🍌', 'banana'], ['🍉', 'watermelon'], ['🍓', 'strawberry'],
      ['🍇', 'grapes'], ['🥑', 'avocado'], ['🥦', 'broccoli'], ['🌶', 'chilli spicy'],
    ],
  },
  {
    id: 'things',
    label: 'Things',
    icon: '💡',
    emoji: [
      ['📱', 'phone mobile'], ['💻', 'laptop computer'], ['⌨️', 'keyboard'],
      ['🖥', 'desktop monitor'], ['🖨', 'printer'], ['📷', 'camera photo'],
      ['🎥', 'video camera film'], ['🎧', 'headphones music'], ['🎤', 'mic sing'],
      ['📺', 'tv'], ['🔋', 'battery'], ['🔌', 'plug'], ['💡', 'idea bulb light'],
      ['🔦', 'torch flashlight'], ['📞', 'phone call'], ['📩', 'mail envelope'],
      ['📦', 'package box'], ['✏️', 'pencil write'], ['📝', 'memo note'],
      ['📚', 'books read'], ['📅', 'calendar date'], ['⏰', 'alarm clock time'],
      ['⏳', 'hourglass wait'], ['🔑', 'key'], ['🔒', 'lock secure'],
      ['🛒', 'cart shopping'], ['💰', 'money bag'], ['💳', 'card pay'],
      ['🧾', 'receipt bill'], ['📈', 'chart up growth'], ['📉', 'chart down'],
      ['🏠', 'house home'], ['🏢', 'office building'], ['🏥', 'hospital'],
      ['🏫', 'school'], ['⛺', 'tent camp'], ['🚗', 'car drive'], ['🚕', 'taxi'],
      ['🚌', 'bus'], ['🚲', 'bike cycle'], ['🛵', 'scooter'], ['✈️', 'plane fly travel'],
      ['🚆', 'train'], ['🚀', 'rocket launch'], ['⛽', 'fuel petrol'], ['🧳', 'luggage trip'],
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '✅',
    emoji: [
      ['✅', 'check tick done yes'], ['❌', 'cross no wrong'], ['❗', 'exclamation'],
      ['❓', 'question'], ['⚠️', 'warning caution'], ['🚫', 'no forbidden'],
      ['➕', 'plus add'], ['➖', 'minus'], ['✔️', 'check mark'], ['🔁', 'repeat loop'],
      ['🔀', 'shuffle'], ['▶️', 'play'], ['⏸', 'pause'], ['⏹', 'stop'],
      ['🔊', 'loud volume'], ['🔇', 'mute silent'], ['🔔', 'bell notify'],
      ['🔕', 'bell off mute'], ['📌', 'pin'], ['📍', 'location place'],
      ['🔗', 'link'], ['♻️', 'recycle'], ['🆗', 'ok'], ['🆕', 'new'],
      ['🔝', 'top up'], ['💬', 'speech chat'], ['💭', 'thought bubble'],
      ['🗯', 'anger bubble'], ['🕐', 'clock time'], ['©️', 'copyright'],
      ['🎮', 'game controller play'], ['🎲', 'dice'], ['♟', 'chess'],
      ['🧩', 'puzzle piece'], ['🎨', 'art paint'], ['🎬', 'clapper film'],
      ['⚽', 'football soccer'], ['🏀', 'basketball'], ['🏏', 'cricket'],
      ['🏸', 'badminton'], ['🎾', 'tennis'], ['🥊', 'boxing'], ['🏊', 'swim'],
    ],
  },
];

const RECENT_KEY = 'nook.emoji.recent';
const RECENT_MAX = 24;

const readRecent = (): string[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((e) => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  /** Where to sit — the emoji button's box, so the sheet points at it. */
  anchor?: { left: number; bottom: number } | null;
}

export default function EmojiPicker({ open, onClose, onPick, anchor }: Props) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState(GROUPS[0].id);
  const [recent, setRecent] = useState<string[]>([]);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRecent(readRecent());
    // Focus the search box on a pointer-less device, but never on touch —
    // raising the on-screen keyboard would cover the emoji you came for.
    if (window.matchMedia('(pointer: fine)').matches) {
      window.setTimeout(() => search.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // `pointerdown` rather than `click`: closing on click would fire after the
    // composer had already taken focus back, which reads as a dropped tap.
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hits: string[] = [];
    for (const g of GROUPS) {
      for (const [emoji, names] of g.emoji) {
        if (names.includes(q) || names.split(' ').some((n) => n.startsWith(q))) hits.push(emoji);
      }
    }
    return hits;
  }, [query]);

  const pick = (emoji: string) => {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode; the picker still works, it just forgets */
    }
    onPick(emoji);
  };

  const shown = results ?? GROUPS.find((g) => g.id === group)?.emoji.map(([e]) => e) ?? [];

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panel}
          className="emoji-pop clay"
          style={
            anchor
              ? { left: Math.max(12, anchor.left), bottom: anchor.bottom }
              : { left: 12, bottom: 96 }
          }
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={spring}
          role="dialog"
          aria-label="Choose an emoji"
        >
          <div className="emoji-pop-search">
            <IconSearch size={16} />
            <input
              ref={search}
              className="emoji-pop-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search emoji"
              aria-label="Search emoji"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
            {query ? (
              <button onClick={() => setQuery('')} aria-label="Clear search">
                <IconClose size={15} />
              </button>
            ) : (
              <button onClick={onClose} aria-label="Close" className="emoji-pop-close">
                <IconClose size={15} />
              </button>
            )}
          </div>

          <div className="emoji-pop-grid" role="grid">
            {results && results.length === 0 && (
              <p className="small muted emoji-pop-empty">
                Nothing matches “{query.trim()}”. Try a plainer word — “happy”, “cat”, “fire”.
              </p>
            )}

            {!results && recent.length > 0 && (
              <>
                <span className="emoji-pop-heading">
                  <IconClock size={12} /> Recent
                </span>
                <div className="emoji-pop-row">
                  {recent.map((e) => (
                    <button key={`r-${e}`} className="emoji-cell" onClick={() => pick(e)} aria-label={e}>
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}

            {!results && (
              <span className="emoji-pop-heading">
                {GROUPS.find((g) => g.id === group)?.label}
              </span>
            )}

            <div className="emoji-pop-row">
              {shown.map((e) => (
                <button key={e} className="emoji-cell" onClick={() => pick(e)} aria-label={e}>
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Categories last in the DOM but shown at the bottom: it puts them
              under the thumb on a phone, and keeps tab order search → emoji →
              categories, which is the order you actually use them in. */}
          <div className="emoji-pop-tabs" role="tablist" aria-label="Emoji categories">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                className={`emoji-tab${!results && group === g.id ? ' on' : ''}`}
                onClick={() => {
                  setQuery('');
                  setGroup(g.id);
                }}
                role="tab"
                aria-selected={!results && group === g.id}
                aria-label={g.label}
                title={g.label}
              >
                {g.icon}
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
