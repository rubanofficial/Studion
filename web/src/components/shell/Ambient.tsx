/**
 * The ambient layer.
 *
 * This is the one purely atmospheric element in the product, and it earns its
 * place by being *informational*: the wash shifts hue with the active subject and
 * intensity with the timer state, so a glance from across the room tells you
 * whether the instrument is idle, working, resting or paused.
 *
 * It is painted with CSS gradients rather than a canvas. A requestAnimationFrame
 * loop running for the entire life of the app just to draw two soft blobs would
 * cost battery on the device a student is most likely to be using.
 */

import { useEffect, useState } from 'react';

import { useApp } from '../../store/app';
import { useTimer } from '../../store/timer';

export function Ambient({ suppressed }: { suppressed?: boolean }) {
  const phase = useTimer().phase;
  const settings = useApp((state) => state.settings);
  const focusMode = useApp((state) => state.focusMode);
  const [pulse, setPulse] = useState(false);

  /**
   * A slow breath while focusing.
   *
   * Deliberately 4-second cadence rather than the timer's 1Hz tick: a background
   * that pulses once a second becomes a metronome the eye cannot ignore, which
   * is the opposite of what a focus tool should do.
   */
  useEffect(() => {
    if (phase !== 'focus' || settings?.reduceMotion) {
      setPulse(false);
      return;
    }
    const handle = setInterval(() => setPulse((value) => !value), 2200);
    return () => clearInterval(handle);
  }, [phase, settings?.reduceMotion]);

  const ambientOff = suppressed || settings?.ambientBackground === false;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void">
      {!ambientOff && (
        <div
          className="absolute inset-0 transition-opacity duration-slow ease-forge"
          style={{
            opacity: focusMode ? 0.55 : 1,
          }}
        >
          <div className={`ambient absolute inset-0 ${pulse ? 'animate-breathe' : ''}`} />
        </div>
      )}
      {/* A very faint grid, masked to the centre. Structure without noise. */}
      <div className="gridlines absolute inset-0 opacity-[0.55]" />
      {/* Bottom vignette keeps the dock legible over the wash. */}
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-void via-void/70 to-transparent" />
    </div>
  );
}
