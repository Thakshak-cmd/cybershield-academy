import { useCallback, useEffect, useState } from "react";

/**
 * Palette selection.
 *
 * The two palettes are offered as light and dark. They are not one design at two
 * brightnesses -- Nightwatch is a blue-slate operations room, Vellum is parchment
 * and ink -- so this is closer to a day shift and a night shift than to a
 * conventional theme toggle. That is a deliberate choice, and it is why the
 * control is labelled by name rather than by a sun and moon.
 *
 * Resolution order:
 *   1. A study participant's pinned palette   (removes a variable from the study)
 *   2. Whatever the user last chose            (persisted)
 *   3. The operating system's preference       (default)
 */

const STORE_KEY = "cybershield.palette";

export const PALETTES = [
  { id: "vellum", name: "Vellum", scheme: "light", note: "a case file on a desk" },
  { id: "nightwatch", name: "Nightwatch", scheme: "dark", note: "night shift, operations room" }
];

/** Which palette a participant is served. See the note in setPalette below. */
export const STUDY_PALETTE = "nightwatch";

const byScheme = scheme => PALETTES.find(p => p.scheme === scheme)?.id ?? "nightwatch";

function systemPalette() {
  if (typeof window === "undefined" || !window.matchMedia) return "nightwatch";
  return byScheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function stored() {
  try {
    const value = localStorage.getItem(STORE_KEY);
    return PALETTES.some(p => p.id === value) ? value : null;
  } catch {
    // Safari in private mode throws on localStorage. A theme preference is not
    // worth failing the whole app over.
    return null;
  }
}

/**
 * @param {{ isStudyParticipant?: boolean }} [options]
 */
export function usePalette({ isStudyParticipant = false } = {}) {
  const [palette, setPaletteState] = useState(() =>
    isStudyParticipant ? STUDY_PALETTE : (stored() ?? systemPalette())
  );
  const [following, setFollowing] = useState(() => !isStudyParticipant && !stored());

  // A participant who signs in after the app has mounted still gets pinned.
  useEffect(() => {
    if (isStudyParticipant) {
      setPaletteState(STUDY_PALETTE);
      setFollowing(false);
    }
  }, [isStudyParticipant]);

  useEffect(() => {
    document.documentElement.setAttribute("data-palette", palette);
  }, [palette]);

  // Track the system preference while the user has not overridden it, so changing
  // the OS setting is reflected without a reload.
  useEffect(() => {
    if (!following || isStudyParticipant || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPaletteState(byScheme(mq.matches ? "dark" : "light"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [following, isStudyParticipant]);

  const setPalette = useCallback(
    /** @param {string|null} id  null returns to following the system */
    id => {
      // Participants keep the pinned palette.
      //
      // This is a default, not a security control: the value lives in the browser
      // and a determined participant could change it. It removes an accidental
      // variable, not a deliberate one, and the study protocol is what actually
      // holds participants to a single design.
      if (isStudyParticipant) return;

      if (id === null) {
        try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
        setFollowing(true);
        setPaletteState(systemPalette());
        return;
      }
      try { localStorage.setItem(STORE_KEY, id); } catch { /* ignore */ }
      setFollowing(false);
      setPaletteState(id);
    },
    [isStudyParticipant]
  );

  return { palette, setPalette, following, pinned: isStudyParticipant };
}
