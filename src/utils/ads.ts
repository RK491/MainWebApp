import type { AdConfig, AdNetworkId } from '../types/farm';

interface AdsgramController {
  show: () => Promise<{ done?: boolean; description?: string; error?: boolean }>;
}

declare global {
  interface Window {
    Adsgram?: {
      init: (opts: { blockId: string }) => AdsgramController;
    };
    showGiga?: () => Promise<unknown>;
    [key: string]: unknown;
  }
}

function getClientEnvVar(key: string): string {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    return (meta?.env?.[key] || '').trim();
  } catch {
    return '';
  }
}

export function resolveEffectiveAdConfig(config: AdConfig): AdConfig {
  return {
    ...config,
    adsgramBlockId: config.adsgramBlockId.trim() || getClientEnvVar('VITE_ADSGRAM_BLOCK_ID'),
    gigapubProjectId:
      (config.gigapubProjectId || '').trim() || getClientEnvVar('VITE_GIGAPUB_PROJECT_ID'),
    monetagZoneId: config.monetagZoneId.trim() || getClientEnvVar('VITE_MONETAG_ZONE_ID'),
  };
}

export function hasConfiguredAdNetworkSdk(network: AdNetworkId, config: AdConfig): boolean {
  const effective = resolveEffectiveAdConfig(config);
  if (network === 'adsgram') return Boolean(effective.adsgramBlockId);
  if (network === 'gigapub') return Boolean(effective.gigapubProjectId);
  return Boolean(effective.monetagZoneId);
}

function isExternalAdCompleted(result: unknown): boolean {
  if (result === false) return false;
  if (typeof result === 'object' && result !== null) {
    const rec = result as { done?: unknown; error?: unknown };
    if (rec.error === true) return false;
    if (rec.done === false) return false;
  }
  return true;
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

export async function tryRunAdNetwork(
  network: AdNetworkId,
  config: AdConfig,
): Promise<{ handled: boolean; rewarded: boolean; message?: string }> {
  const effective = resolveEffectiveAdConfig(config);

  if (network === 'adsgram' && effective.adsgramBlockId) {
    try {
      await loadScriptOnce('adsgram-sdk', 'https://sad.adsgram.ai/js/sad.min.js');
      if (window.Adsgram) {
        const controller = window.Adsgram.init({ blockId: effective.adsgramBlockId });
        const result = await controller.show();
        return {
          handled: true,
          rewarded: result?.done === true && result?.error !== true,
        };
      }
    } catch {
      return {
        handled: false,
        rewarded: false,
        message: 'AdsGram SDK unavailable in this browser — using verified timer ad.',
      };
    }
  }

  if (network === 'gigapub' && effective.gigapubProjectId) {
    const projectId = effective.gigapubProjectId.replace(/[^a-zA-Z0-9_-]/g, '');
    try {
      await loadScriptOnce(
        `gigapub-sdk-${projectId}`,
        `https://ad.gigapub.tech/script?id=${encodeURIComponent(projectId)}`,
      );
      if (typeof window.showGiga === 'function') {
        const result = await window.showGiga();
        return { handled: true, rewarded: isExternalAdCompleted(result) };
      }
    } catch {
      return {
        handled: false,
        rewarded: false,
        message: 'Gigapub SDK unavailable in this browser — using verified timer ad.',
      };
    }
  }

  if (network === 'monetag' && effective.monetagZoneId) {
    const zoneId = effective.monetagZoneId.replace(/[^a-zA-Z0-9_-]/g, '');
    const fnName = `show_${zoneId}`;
    try {
      await loadScriptOnce(`monetag-sdk-${zoneId}`, '//libtl.com/sdk.js', {
        'data-zone': zoneId,
        'data-sdk': fnName,
      });
      const showFn = window[fnName];
      if (typeof showFn === 'function') {
        const result = await (showFn as () => Promise<unknown>)();
        return { handled: true, rewarded: isExternalAdCompleted(result) };
      }
    } catch {
      return {
        handled: false,
        rewarded: false,
        message: 'Monetag SDK blocked or unavailable — using verified timer ad.',
      };
    }
  }

  return { handled: false, rewarded: false };
}

export async function tryRunExternalRewardedAd(
  config: AdConfig,
): Promise<{ handled: boolean; rewarded: boolean; message?: string }> {
  const effective = resolveEffectiveAdConfig(config);
  if (
    effective.provider === 'adsgram' ||
    effective.provider === 'gigapub' ||
    effective.provider === 'monetag'
  ) {
    return tryRunAdNetwork(effective.provider, effective);
  }
  return { handled: false, rewarded: false };
}
