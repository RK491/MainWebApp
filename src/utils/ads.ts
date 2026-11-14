import type { AdConfig } from '../types/farm';

interface AdsgramController {
  show: () => Promise<{ done?: boolean; description?: string }>;
}

declare global {
  interface Window {
    Adsgram?: {
      init: (opts: { blockId: string }) => AdsgramController;
    };
    [key: string]: unknown;
  }
}

function loadScriptOnce(id: string, src: string, attrs?: Record<string, string>): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('No document available'));
  }
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) {
    if (existing.dataset.loaded === '1') return Promise.resolve();
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Ad SDK failed to load')), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        script.setAttribute(k, v);
      }
    }
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error('Ad SDK failed to load'));
    document.head.appendChild(script);
  });
}

export async function tryRunExternalRewardedAd(
  config: AdConfig,
): Promise<{ handled: boolean; rewarded: boolean; message?: string }> {
  if (config.provider === 'adsgram' && config.adsgramBlockId.trim()) {
    try {
      await loadScriptOnce('adsgram-sdk', 'https://sad.adsgram.ai/js/sad.min.js');
      if (window.Adsgram) {
        const controller = window.Adsgram.init({ blockId: config.adsgramBlockId.trim() });
        const result = await controller.show();
        return { handled: true, rewarded: Boolean(result?.done ?? true) };
      }
    } catch {
      return {
        handled: false,
        rewarded: false,
        message: 'Adsgram SDK unavailable in this browser — using built-in rewarded player.',
      };
    }
  }

  if (config.provider === 'monetag' && config.monetagZoneId.trim()) {
    const zoneId = config.monetagZoneId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const fnName = `show_${zoneId}`;
    try {
      await loadScriptOnce(`monetag-sdk-${zoneId}`, '//libtl.com/sdk.js', {
        'data-zone': zoneId,
        'data-sdk': fnName,
      });
      const showFn = window[fnName];
      if (typeof showFn === 'function') {
        await (showFn as () => Promise<unknown>)();
        return { handled: true, rewarded: true };
      }
    } catch {
      return {
        handled: false,
        rewarded: false,
        message: 'Monetag SDK blocked or unavailable — using built-in rewarded player.',
      };
    }
  }

  return { handled: false, rewarded: false };
}
