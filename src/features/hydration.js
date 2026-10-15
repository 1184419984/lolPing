'use strict';

globalThis.feature = {
  handle(input) {
    const { event, context: c } = input;
    const interval = c.settings.intervalMin * 60000;
    let s = input.state;
    if (!s || typeof s !== 'object' || !Number.isFinite(s.nextAt) || !Number.isFinite(s.lastNow)) {
      s = { nextAt: c.now + interval, interval, enabled: c.settings.enabled, paused: c.paused, lastNow: c.now };
    }
    const commands = [];
    if (event === 'activate' || s.interval !== interval || s.enabled !== c.settings.enabled || s.paused !== c.paused || c.now < s.lastNow) {
      s = { nextAt: c.now + interval, interval, enabled: c.settings.enabled, paused: c.paused };
    }
    s.lastNow = c.now;
    if (event === 'action' && input.data === 'preview' || event === 'tick' && c.settings.enabled && c.now >= s.nextAt) {
      if (!c.paused && !c.busy) {
        commands.push({ op: 'show', scene: {
          key: 'water', display: 'all', durationS: c.settings.durationS, width: 0.8, x: 0.5, y: 0.5,
          dim: true, animation: 'fullscreen', elements: [
            { type: 'image', asset: 'builtin:hydration', height: 0.7 },
            { type: 'text', text: c.texts.hydrationTitle, size: 32, color: '#ffffff' },
          ],
        } });
        commands.push({ op: 'sound', asset: 'builtin:Base', volume: 1 });
        s.nextAt = c.now + interval;
      }
    }
    return { state: s, commands };
  },
};
