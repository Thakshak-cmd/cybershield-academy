import { useCallback, useEffect, useState } from "react";

/**
 * A two-route history router.
 *
 * react-router is the conventional answer and would be the right call the moment
 * this grows nested routes, params or loaders. For two flat paths it is about
 * 15KB gzipped to replace twenty lines, and swapping to it later is an hour's
 * work -- so the dependency waits until it earns its place.
 */

/** @returns {[string, (path: string) => void]} */
export function useRoute() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    // Back and forward buttons. Without this the URL changes and the view does
    // not, which is the specific way hand-rolled routers feel broken.
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next) => {
    if (next === window.location.pathname) return;
    window.history.pushState({}, "", next);
    setPath(next);
  }, []);

  return [path, navigate];
}

/**
 * A link that navigates without a full page load, while remaining a real anchor.
 *
 * Middle-click, ctrl-click and "open in new tab" all have to keep working, which
 * a div with an onClick would silently break.
 */
export function Link({ to, navigate, children, ...rest }) {
  return (
    <a
      href={to}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
