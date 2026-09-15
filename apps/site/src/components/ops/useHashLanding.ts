import { useEffect } from "react";

/**
 * React draws the page after the browser has already tried to scroll to `#section`, so the page lands
 * there itself: on mount, again once the web fonts have settled the headings' height, and again when
 * `ready` turns true and the content above has its final height.
 */
export function useHashLanding(ready: boolean) {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return undefined;
    let cancelled = false;
    const land = () => {
      if (!cancelled) document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    land();
    void document.fonts.ready.then(land);
    return () => {
      cancelled = true;
    };
  }, [ready]);
}
