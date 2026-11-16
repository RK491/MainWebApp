import { useEffect, useState } from 'react';
import {
  Check,
  FlipHorizontal2,
  MapPin,
  RotateCcw,
  Sparkles,
  Trees,
  X,
} from 'lucide-react';
import {
  buildPresetLayout,
  countEnabledFarmArtifacts,
  FARM_ARTIFACT_CATEGORIES,
  FARM_ARTIFACT_PRESETS,
  FARM_ARTIFACTS,
  type FarmArtifactCategory,
  type FarmArtifactId,
  type FarmArtifactLayout,
  type FarmArtifactPresetId,
  type FarmArtifactSlot,
} from '../game/farmArtifacts';

interface FarmArtifactsDrawerProps {
  layout: FarmArtifactLayout;
  onChangeLayout: (next: FarmArtifactLayout) => void;
  onSoftTap?: () => void;
  onClose: () => void;
}

const SLOT_ORDER: FarmArtifactSlot[] = ['left', 'center', 'right'];
const SLOT_LABELS: Record<FarmArtifactSlot, string> = {
  left: 'Left',
  center: 'Center',
  right: 'Right',
};

export function FarmArtifactsDrawer({
  layout,
  onChangeLayout,
  onSoftTap,
  onClose,
}: FarmArtifactsDrawerProps) {
  const [category, setCategory] = useState<FarmArtifactCategory | 'all'>('all');

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeCount = countEnabledFarmArtifacts(layout);
  const filteredArtifacts =
    category === 'all'
      ? FARM_ARTIFACTS
      : FARM_ARTIFACTS.filter((item) => item.category === category);

  const handleApplyPreset = (presetId: FarmArtifactPresetId) => {
    onSoftTap?.();
    onChangeLayout(buildPresetLayout(presetId));
  };

  const handleToggleArtifact = (id: FarmArtifactId) => {
    onSoftTap?.();
    const cur = layout.items[id];
    onChangeLayout({
      ...layout,
      items: {
        ...layout.items,
        [id]: {
          ...cur,
          enabled: !cur.enabled,
        },
      },
    });
  };

  const handleCycleSpot = (id: FarmArtifactId) => {
    onSoftTap?.();
    const cur = layout.items[id];
    const nextIdx = (SLOT_ORDER.indexOf(cur.spot) + 1) % SLOT_ORDER.length;
    onChangeLayout({
      ...layout,
      items: {
        ...layout.items,
        [id]: {
          ...cur,
          spot: SLOT_ORDER[nextIdx],
        },
      },
    });
  };

  const handleToggleFlip = (id: FarmArtifactId) => {
    onSoftTap?.();
    const cur = layout.items[id];
    onChangeLayout({
      ...layout,
      items: {
        ...layout.items,
        [id]: {
          ...cur,
          flipped: !cur.flipped,
        },
      },
    });
  };

  return (
    <div
      className="animate-clay-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 dark:bg-black/75 backdrop-blur-xs p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="farm-artifacts-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="animate-clay-modal clay-card w-full sm:max-w-xl max-h-[88vh] flex flex-col !rounded-t-[2rem] sm:!rounded-[2rem] overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3.5 border-b border-stone-200/70 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl clay-icon-well text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <Trees className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="farm-artifacts-drawer-title"
                  className="text-lg font-extrabold text-stone-900 dark:text-stone-100 truncate"
                >
                  Farm Artifacts
                </h2>
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[11px] font-extrabold font-mono-num text-emerald-800 dark:text-emerald-300 shrink-0">
                  {activeCount}/{FARM_ARTIFACTS.length}
                </span>
              </div>
              <p className="text-xs text-stone-500 dark:text-stone-400 truncate">
                Arrange barns, fences, hay bales, ponds &amp; wildflowers on your meadow
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleApplyPreset('homestead')}
              aria-label="Reset farm artifacts to Cozy Homestead default"
              title="Reset to default layout"
              className="clay-btn clay-btn-neutral h-9 px-2.5 rounded-xl text-xs font-extrabold inline-flex items-center gap-1 text-stone-700 dark:text-stone-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <button
              type="button"
              aria-label="Close farm artifacts studio"
              onClick={onClose}
              className="clay-btn clay-btn-neutral w-9 h-9 rounded-xl flex items-center justify-center text-stone-600 dark:text-stone-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {/* Scenic Presets */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-stone-500 dark:text-stone-400 px-0.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Meadow Presets</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {FARM_ARTIFACT_PRESETS.map((preset) => {
                const isSelected = layout.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset.id)}
                    className={`clay-btn min-h-[54px] rounded-2xl px-3 py-2 text-left transition-all ${
                      isSelected
                        ? 'clay-card-warm ring-2 ring-amber-400/80 dark:ring-amber-400/60'
                        : 'clay-inset hover:brightness-[0.98]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-extrabold text-stone-900 dark:text-stone-100 truncate">
                        {preset.name}
                      </span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      )}
                    </div>
                    <div className="text-[10px] font-semibold text-stone-500 dark:text-stone-400 truncate mt-0.5">
                      {preset.subtitle}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {FARM_ARTIFACT_CATEGORIES.map((cat) => {
              const active = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    onSoftTap?.();
                    setCategory(cat.id);
                  }}
                  className={`clay-btn min-h-[36px] px-3 rounded-xl text-xs font-extrabold whitespace-nowrap ${
                    active
                      ? 'clay-btn-amber'
                      : 'clay-btn-neutral text-stone-600 dark:text-stone-300'
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Artifacts Catalog Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {filteredArtifacts.map((artifact) => {
              const itemState = layout.items[artifact.id];
              const isPlaced = itemState.enabled;
              return (
                <div
                  key={artifact.id}
                  className={`${
                    isPlaced ? 'clay-card-mint' : 'clay-card'
                  } !rounded-2xl p-3 flex flex-col justify-between gap-2.5 transition-all`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-2xl clay-icon-well p-1.5 flex items-center justify-center shrink-0 overflow-hidden">
                      <img
                        src={artifact.sprite}
                        alt={artifact.name}
                        referrerPolicy="no-referrer"
                        className={`max-w-full max-h-full object-contain drop-shadow-sm transition-transform ${
                          itemState.flipped ? '-scale-x-100' : ''
                        }`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-extrabold text-stone-900 dark:text-stone-100 truncate">
                        {artifact.name}
                      </div>
                      <div className="text-[11px] font-medium text-stone-500 dark:text-stone-400 truncate">
                        {artifact.tagline}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                          {artifact.spots[itemState.spot].zLayer === 'back' ? 'Pasture layer' : 'Meadow front'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleToggleArtifact(artifact.id)}
                      className={`clay-btn flex-1 min-h-[38px] rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-1 ${
                        isPlaced ? 'clay-btn-emerald' : 'clay-btn-amber'
                      }`}
                    >
                      {isPlaced ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Placed</span>
                        </>
                      ) : (
                        <span>Place Prop</span>
                      )}
                    </button>

                    {isPlaced && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleCycleSpot(artifact.id)}
                          aria-label={`Move ${artifact.name} spot (currently ${SLOT_LABELS[itemState.spot]})`}
                          title="Switch spot: Left / Center / Right"
                          className="clay-btn clay-btn-neutral min-h-[38px] px-2.5 rounded-xl text-[11px] font-extrabold inline-flex items-center gap-1 text-stone-700 dark:text-stone-200"
                        >
                          <MapPin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          <span>{SLOT_LABELS[itemState.spot]}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleFlip(artifact.id)}
                          aria-label={`Flip ${artifact.name} horizontally`}
                          title="Flip prop horizontally"
                          className={`clay-btn min-h-[38px] w-[38px] rounded-xl flex items-center justify-center ${
                            itemState.flipped
                              ? 'clay-btn-sky'
                              : 'clay-btn-neutral text-stone-700 dark:text-stone-200'
                          }`}
                        >
                          <FlipHorizontal2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
