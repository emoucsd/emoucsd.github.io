// Frame-budget loop for the mission clock (system spec §6.3.8).
//
// The page may stay open for hours, so the loop is a thermal budget rather than a
// smoothness contest: 30 fps while the viewer is interacting, 10 fps after a minute
// idle, and no rAF at all while the document is hidden. Every clock and timer is
// injected so tests can drive the loop with a fake rAF and a fake now.

export const FPS_ACTIVE = 30;
export const FPS_IDLE = 10;
export const IDLE_AFTER_MS = 60_000;

const STAMP = 1e-6;

export function createScheduler({ raf, caf, now, hidden, onFrame }) {
  if (typeof raf !== 'function' || typeof caf !== 'function') {
    throw new TypeError('createScheduler requires raf and caf');
  }
  if (typeof now !== 'function' || typeof hidden !== 'function' || typeof onFrame !== 'function') {
    throw new TypeError('createScheduler requires now, hidden and onFrame');
  }

  let running = false;
  let handle = 0;
  let lastDraw = -Infinity;
  let lastInteract = 0;
  let wasHidden = false;

  const rate = () => (now() - lastInteract >= IDLE_AFTER_MS ? FPS_IDLE : FPS_ACTIVE);

  const fire = (t) => {
    lastDraw = t;
    onFrame(t);
  };

  const schedule = () => {
    if (!running || handle) return;
    if (hidden()) {
      wasHidden = true;
      return;
    }
    handle = raf(tick);
  };

  const tick = () => {
    handle = 0;
    if (!running) return;
    if (hidden()) {
      wasHidden = true;
      return;
    }
    const t = now();
    if (wasHidden) {
      wasHidden = false;
      fire(t);
      schedule();
      return;
    }
    const minDt = 1000 / rate();
    if (t - lastDraw >= minDt - STAMP) fire(t);
    schedule();
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastInteract = now();
      wasHidden = !!hidden();
      if (!wasHidden) fire(now());
      schedule();
    },
    stop() {
      running = false;
      if (handle) caf(handle);
      handle = 0;
    },
    touch() {
      lastInteract = now();
    },
    notifyVisibility() {
      if (!running) return;
      if (hidden()) {
        wasHidden = true;
        if (handle) {
          caf(handle);
          handle = 0;
        }
        return;
      }
      if (wasHidden) {
        wasHidden = false;
        fire(now());
      }
      schedule();
    },
    destroy() {
      this.stop();
    },
    getRate: rate,
    get running() {
      return running;
    },
  };
}
