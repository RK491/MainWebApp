export interface ShareNavigatorLike {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: {
    writeText: (text: string) => Promise<void>;
  };
}

export type ShareReferralOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export function buildPersonalReferralUrl(referralCode: string, origin?: string): string {
  const fallbackOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://chickenland.farm';
  const cleanOrigin = (origin ?? fallbackOrigin).replace(/\/+$/, '');
  const cleanCode = referralCode.trim();
  if (!cleanCode) {
    return cleanOrigin;
  }
  return `${cleanOrigin}/?ref=${encodeURIComponent(cleanCode)}`;
}

export function buildReferralShareData(
  referralCode: string,
  referralUrl: string,
  referrerName?: string,
): ShareData {
  const cleanName = (referrerName || '').trim();
  const possessiveOwner = cleanName ? `${cleanName}'s` : 'my';
  const codeFragment = referralCode.trim() ? ` using code ${referralCode.trim()}` : '';

  return {
    title: 'Join my ChickenLand Farm!',
    text: `Join ${possessiveOwner} ChickenLand farm${codeFragment} and claim +1,000 sign-up bonus coins!`,
    url: referralUrl,
  };
}

export async function copyTextWithFallback(
  text: string,
  nav?: ShareNavigatorLike,
): Promise<boolean> {
  const targetNav = nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  if (targetNav?.clipboard && typeof targetNav.clipboard.writeText === 'function') {
    try {
      await targetNav.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to legacy textarea copy inside restricted iframes
    }
  }

  if (typeof document !== 'undefined' && document.body && typeof document.createElement === 'function') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      document.body.removeChild(textarea);
      if (copied) {
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

export async function shareReferralLink(params: {
  referralCode: string;
  referralUrl: string;
  referrerName?: string;
  nav?: ShareNavigatorLike;
}): Promise<ShareReferralOutcome> {
  const targetNav = params.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);
  const shareData = buildReferralShareData(
    params.referralCode,
    params.referralUrl,
    params.referrerName,
  );

  if (targetNav && typeof targetNav.share === 'function') {
    let canAttemptShare = true;
    if (typeof targetNav.canShare === 'function') {
      try {
        canAttemptShare = targetNav.canShare(shareData);
      } catch {
        canAttemptShare = true;
      }
    }

    if (canAttemptShare) {
      try {
        await targetNav.share(shareData);
        return 'shared';
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return 'cancelled';
        }
        if (typeof err === 'object' && err !== null && 'name' in err && (err as { name?: string }).name === 'AbortError') {
          return 'cancelled';
        }
        // Other Web Share errors (e.g., NotAllowedError in iframes) fall back to clipboard copy
      }
    }
  }

  const copied = await copyTextWithFallback(params.referralUrl, targetNav);
  return copied ? 'copied' : 'failed';
}
