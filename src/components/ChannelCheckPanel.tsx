import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { REQUIRED_TELEGRAM_CHANNELS } from '../game/economy';
import type { ChannelVerificationItem, ChannelVerificationResult } from '../types/farm';
import { notifyTelegramOpenLink } from '../utils/telegram';

interface ChannelCheckCardProps {
  verification?: ChannelVerificationResult | null;
  checking?: boolean;
  onCheckChannels: () => void;
  variant?: 'default' | 'compact';
}

function buildFallbackItems(): ChannelVerificationItem[] {
  return REQUIRED_TELEGRAM_CHANNELS.map((ch) => ({
    ...ch,
    joined: false,
    status: 'unchecked',
  }));
}

function openChannelLink(url: string) {
  const handled = notifyTelegramOpenLink(url);
  if (!handled && typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function ChannelCheckCard({
  verification,
  checking = false,
  onCheckChannels,
  variant = 'default',
}: ChannelCheckCardProps) {
  const items =
    verification && verification.channels.length > 0
      ? verification.channels
      : buildFallbackItems();

  const mode = verification?.verificationMode;
  const allJoined = Boolean(verification?.allJoined);
  const isStrictTelegram = mode === 'telegram_bot';
  const joinedCount = items.filter((item) => item.joined).length;
  const isCompact = variant === 'compact';

  const statusBadge = (() => {
    if (!verification) {
      return {
        label: 'Not Checked',
        className:
          'bg-stone-100 dark:bg-stone-800 border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300',
      };
    }
    if (allJoined && isStrictTelegram) {
      return {
        label: `${joinedCount}/${items.length} Joined`,
        className:
          'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300',
      };
    }
    if (isStrictTelegram) {
      return {
        label: `${joinedCount}/${items.length} Joined`,
        className:
          'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800/70 text-amber-700 dark:text-amber-300',
      };
    }
    return {
      label: mode === 'bot_unconfigured' ? 'Bot Setup Needed' : 'TG Check Ready',
      className:
        'bg-sky-50 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800/70 text-sky-700 dark:text-sky-300',
    };
  })();

  return (
    <div
      className={`clay-card ${isCompact ? 'p-3.5 space-y-2.5' : 'p-4 space-y-3'} border ${
        allJoined && isStrictTelegram
          ? 'border-emerald-200/80 dark:border-emerald-800/60'
          : 'border-sky-200/80 dark:border-sky-800/60'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`${
              isCompact ? 'w-9 h-9 rounded-xl' : 'w-10 h-10 rounded-2xl'
            } clay-icon-well flex items-center justify-center shrink-0`}
          >
            {allJoined && isStrictTelegram ? (
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Send className="w-4 h-4 text-sky-600 dark:text-sky-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className={`${isCompact ? 'text-xs' : 'text-sm'} font-extrabold text-stone-900 dark:text-stone-100 truncate`}>
              Required Channels Check
            </div>
            <div className="text-[11px] font-medium text-stone-500 dark:text-stone-400 truncate">
              Join @AIRDROP_GALAXYS &amp; @AG_PAYOUTS
            </div>
          </div>
        </div>

        <span
          className={`rounded-lg border px-2 py-0.5 text-[11px] font-extrabold font-mono-num shrink-0 ${statusBadge.className}`}
        >
          {statusBadge.label}
        </span>
      </div>

      <div className="space-y-2">
        {items.map((ch) => {
          const isJoined = ch.joined && isStrictTelegram;
          return (
            <div
              key={ch.id}
              className="clay-inset !rounded-xl px-3 py-2 flex items-center justify-between gap-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isJoined ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle
                    className={`w-4 h-4 shrink-0 ${
                      verification && isStrictTelegram
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-sky-600 dark:text-sky-400'
                    }`}
                  />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-stone-900 dark:text-stone-100 truncate">
                    {ch.handle}
                  </div>
                  <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                    {ch.error ? ch.error : ch.title}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {isJoined ? (
                  <span className="text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 px-2 py-1">
                    Joined
                  </span>
                ) : (
                  <a
                    href={ch.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (notifyTelegramOpenLink(ch.url)) {
                        e.preventDefault();
                      }
                    }}
                    className="clay-btn clay-btn-sky min-h-[34px] px-2.5 rounded-xl text-[11px] font-extrabold inline-flex items-center gap-1"
                  >
                    <span>Join</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {verification && mode === 'guest_browser' && (
        <div className="rounded-xl bg-sky-50/90 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 px-3 py-2 text-[11px] font-semibold text-sky-800 dark:text-sky-300">
          Open inside the Telegram Mini App so the bot can verify your live membership in @AIRDROP_GALAXYS &amp; @AG_PAYOUTS.
        </div>
      )}

      {verification && mode === 'bot_unconfigured' && (
        <div className="rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-3 py-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
          Server bot verification requires TELEGRAM_BOT_TOKEN and adding the bot as an Admin in both @AIRDROP_GALAXYS and @AG_PAYOUTS.
        </div>
      )}

      <button
        type="button"
        disabled={checking}
        onClick={() => {
          onCheckChannels();
        }}
        className={`clay-btn w-full min-h-[42px] rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1.5 ${
          allJoined && isStrictTelegram ? 'clay-btn-neutral text-emerald-700 dark:text-emerald-300' : 'clay-btn-emerald'
        } disabled:opacity-60`}
      >
        {checking ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking Channels...</span>
          </>
        ) : allJoined && isStrictTelegram ? (
          <>
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Verified · Re-check Channels</span>
          </>
        ) : (
          <>
            <ShieldCheck className="w-4 h-4" />
            <span>Check Channels</span>
          </>
        )}
      </button>
    </div>
  );
}

interface ChannelCheckModalProps {
  verification?: ChannelVerificationResult | null;
  checking?: boolean;
  onCheckChannels: () => void;
  onClose: () => void;
}

export function ChannelCheckModal({
  verification,
  checking = false,
  onCheckChannels,
  onClose,
}: ChannelCheckModalProps) {
  const items =
    verification && verification.channels.length > 0
      ? verification.channels
      : buildFallbackItems();
  const isStrictTelegram = verification?.verificationMode === 'telegram_bot';
  const allJoined = Boolean(verification?.allJoined);
  const canDismissFreely = !isStrictTelegram || allJoined;

  return (
    <div
      className="animate-clay-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-gate-title"
    >
      <div className="animate-clay-modal clay-card w-full max-w-md p-5 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-11 h-11 rounded-2xl clay-icon-well flex items-center justify-center shrink-0">
              <Send className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            </div>
            <div>
              <h2 id="channel-gate-title" className="text-base font-extrabold text-stone-900 dark:text-stone-100">
                Join Official Channels
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Subscribe to both channels to unlock full rewards &amp; payouts
              </p>
            </div>
          </div>

          {canDismissFreely && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close channel check modal"
              className="clay-btn clay-btn-neutral w-9 h-9 rounded-xl flex items-center justify-center text-stone-600 dark:text-stone-300"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="space-y-2.5">
          {items.map((ch) => {
            const isJoined = ch.joined && isStrictTelegram;
            return (
              <div
                key={ch.id}
                className="clay-inset !rounded-2xl p-3 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {isJoined ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <Send className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-stone-900 dark:text-stone-100 truncate">
                      {ch.handle}
                    </div>
                    <div className="text-xs text-stone-500 dark:text-stone-400 truncate">
                      {ch.error ? ch.error : ch.description}
                    </div>
                  </div>
                </div>

                {isJoined ? (
                  <span className="rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 px-2.5 py-1 text-xs font-extrabold text-emerald-700 dark:text-emerald-300 shrink-0">
                    Joined
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openChannelLink(ch.url)}
                    className="clay-btn clay-btn-sky min-h-[38px] px-3 rounded-xl text-xs font-extrabold inline-flex items-center gap-1 shrink-0"
                  >
                    <span>Join</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <button
            type="button"
            disabled={checking}
            onClick={() => {
              onCheckChannels();
            }}
            className="clay-btn clay-btn-emerald w-full min-h-[46px] rounded-2xl text-sm font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {checking ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying Membership...</span>
              </>
            ) : allJoined && isStrictTelegram ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                <span>Verified! Continue</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Check Channels</span>
              </>
            )}
          </button>

          {canDismissFreely && (
            <button
              type="button"
              onClick={onClose}
              className="clay-btn clay-btn-neutral w-full min-h-[40px] rounded-xl text-xs font-bold text-stone-600 dark:text-stone-300"
            >
              {allJoined ? 'Close' : 'Continue for now'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
