import { useEffect, useState } from 'react';

/** Reactive media query — layout decisions must survive a window resize. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export const usePhone = () => useMediaQuery('(max-width: 640px)');
export const useNarrow = () => useMediaQuery('(max-width: 900px)');
