import { useEffect, useState } from 'react'

/**
 * Track a CSS media query from React.
 *
 * The layout switch cannot be done with `hidden` utility classes: both trees
 * would mount, and each one carries a MapStage with its own WebGL context and
 * MapLibre worker. Only one preview may exist, so the choice has to happen in
 * JavaScript.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])

  return matches
}

/** Matches Tailwind's `lg` breakpoint. */
export const DESKTOP_QUERY = '(min-width: 1024px)'
