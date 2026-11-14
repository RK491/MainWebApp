export interface TelegramWebAppUser {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

export interface DetectedUserIdentity {
  playerId: string | null;
  displayName: string;
  handle: string;
  photoUrl: string;
  startParam: string;
  isTelegramDetected: boolean;
}

interface TelegramWindow {
  Telegram?: {
    WebApp?: {
      ready?: () => void;
      expand?: () => void;
      openTelegramLink?: (url: string) => void;
      initData?: string;
      initDataUnsafe?: {
        user?: TelegramWebAppUser;
        start_param?: string;
      };
      HapticFeedback?: {
        impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
        notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
        selectionChanged?: () => void;
      };
    };
  };
}

export function resolveTelegramUserIdentity(params: {
  tgUser?: TelegramWebAppUser | null;
  startParam?: string;
  search?: string;
}): DetectedUserIdentity {
  const user = params.tgUser;
  if (user && user.id !== undefined && user.id !== null) {
    const rawId = String(user.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const fullName = [user.first_name, user.last_name]
      .filter((s): s is string => Boolean(s && s.trim()))
      .join(' ')
      .trim();
    const displayName = (fullName || user.username || `Farmer ${rawId.slice(-4)}`).slice(0, 60);
    const cleanUser = user.username ? user.username.replace(/^@/, '') : '';
    const handle = (cleanUser ? `@${cleanUser}` : `@tg_${rawId}`).slice(0, 40);
    const photoUrl = (user.photo_url || '').trim().slice(0, 512);

    return {
      playerId: rawId ? `tg_${rawId}` : null,
      displayName,
      handle,
      photoUrl,
      startParam: (params.startParam || '').trim(),
      isTelegramDetected: true,
    };
  }

  // Optional URL query parameter auto-detection (for Telegram WebApp redirects or testing)
  if (params.search) {
    const query = new URLSearchParams(params.search);
    const qId = query.get('tg_id')?.replace(/[^a-zA-Z0-9_-]/g, '') || '';
    const qName = query.get('tg_name')?.trim() || '';
    const qUser = query.get('tg_username')?.trim().replace(/^@/, '') || '';
    const qPhoto = query.get('tg_photo')?.trim() || '';
    const qStart = query.get('startapp')?.trim() || query.get('ref')?.trim() || '';

    if (qId || qName || qUser || qPhoto) {
      const displayName = (qName || qUser || `Farmer ${qId.slice(-4) || 'TG'}`).slice(0, 60);
      const handle = (qUser ? `@${qUser}` : qId ? `@tg_${qId}` : '@farmer').slice(0, 40);
      return {
        playerId: qId ? `tg_${qId}` : null,
        displayName,
        handle,
        photoUrl: qPhoto.slice(0, 512),
        startParam: qStart,
        isTelegramDetected: true,
      };
    }

    return {
      playerId: null,
      displayName: '',
      handle: '',
      photoUrl: '',
      startParam: qStart,
      isTelegramDetected: false,
    };
  }

  return {
    playerId: null,
    displayName: '',
    handle: '',
    photoUrl: '',
    startParam: (params.startParam || '').trim(),
    isTelegramDetected: false,
  };
}

export function detectBrowserTelegramIdentity(): DetectedUserIdentity {
  if (typeof window === 'undefined') {
    return resolveTelegramUserIdentity({});
  }
  const win = window as unknown as TelegramWindow;
  const webApp = win.Telegram?.WebApp;
  try {
    webApp?.ready?.();
    webApp?.expand?.();
  } catch {
    // Ignore outside Telegram
  }

  return resolveTelegramUserIdentity({
    tgUser: webApp?.initDataUnsafe?.user ?? null,
    startParam: webApp?.initDataUnsafe?.start_param ?? '',
    search: window.location.search,
  });
}

export function getTelegramInitData(): string {
  if (typeof window === 'undefined') return '';
  const win = window as unknown as TelegramWindow;
  return (win.Telegram?.WebApp?.initData || '').trim();
}

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

export function triggerHapticFeedback(kind: HapticKind): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as TelegramWindow;
  const hf = win.Telegram?.WebApp?.HapticFeedback;
  if (!hf) return;

  try {
    if (kind === 'selection') {
      hf.selectionChanged?.();
    } else if (kind === 'success' || kind === 'warning' || kind === 'error') {
      hf.notificationOccurred?.(kind);
    } else {
      hf.impactOccurred?.(kind);
    }
  } catch {
    // Ignore unsupported Telegram client versions
  }
}

export function getTelegramChannelUrl(channelHandle: string): string {
  const clean = channelHandle.trim().replace(/^@/, '');
  return `https://t.me/${clean}`;
}

export function notifyTelegramOpenLink(channelUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as TelegramWindow;
  const openTg = win.Telegram?.WebApp?.openTelegramLink;
  if (typeof openTg === 'function') {
    try {
      openTg(channelUrl);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}
