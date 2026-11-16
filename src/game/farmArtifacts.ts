import barnSprite from '../assets/images/artifacts/barn.png';
import bushRoundSprite from '../assets/images/artifacts/bush_round.png';
import bushWideSprite from '../assets/images/artifacts/bush_wide.png';
import fenceCornerSprite from '../assets/images/artifacts/fence_corner.png';
import fenceLongSprite from '../assets/images/artifacts/fence_long.png';
import fenceMediumSprite from '../assets/images/artifacts/fence_medium.png';
import fenceShortSprite from '../assets/images/artifacts/fence_short.png';
import hayBaleLargeSprite from '../assets/images/artifacts/hay_bale_large.png';
import hayBaleSmall1Sprite from '../assets/images/artifacts/hay_bale_small_1.png';
import hayBaleSmall2Sprite from '../assets/images/artifacts/hay_bale_small_2.png';
import pondSprite from '../assets/images/artifacts/pond.png';
import wildflowersSprite from '../assets/images/artifacts/wildflowers.png';
import woodenDeckSprite from '../assets/images/artifacts/wooden_deck.png';

export type FarmArtifactId =
  | 'barn'
  | 'pond'
  | 'wooden_deck'
  | 'hay_bale_large'
  | 'hay_bale_small_1'
  | 'hay_bale_small_2'
  | 'fence_long'
  | 'fence_medium'
  | 'fence_corner'
  | 'fence_short'
  | 'bush_wide'
  | 'bush_round'
  | 'wildflowers';

export type FarmArtifactCategory = 'structures' | 'fences' | 'hay' | 'nature';
export type FarmArtifactSlot = 'left' | 'center' | 'right';
export type FarmArtifactPresetId = 'homestead' | 'pondside' | 'ranch' | 'minimal';

export interface FarmArtifactSpot {
  x: number;
  y: number;
  widthPct: number;
  zLayer: 'back' | 'front';
  defaultFlipX?: boolean;
}

export interface FarmArtifactDefinition {
  id: FarmArtifactId;
  name: string;
  tagline: string;
  category: FarmArtifactCategory;
  sprite: string;
  sway?: boolean;
  spots: Record<FarmArtifactSlot, FarmArtifactSpot>;
}

export interface FarmArtifactItemState {
  enabled: boolean;
  spot: FarmArtifactSlot;
  flipped: boolean;
}

export interface FarmArtifactLayout {
  preset: FarmArtifactPresetId;
  items: Record<FarmArtifactId, FarmArtifactItemState>;
}

export const FARM_ARTIFACT_CATEGORIES: Array<{
  id: FarmArtifactCategory | 'all';
  label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'structures', label: 'Structures' },
  { id: 'fences', label: 'Fences' },
  { id: 'hay', label: 'Hay Bales' },
  { id: 'nature', label: 'Nature' },
];

export const FARM_ARTIFACTS: FarmArtifactDefinition[] = [
  {
    id: 'barn',
    name: 'Thatched Red Barn',
    tagline: 'Cozy timber coop',
    category: 'structures',
    sprite: barnSprite,
    spots: {
      left: { x: 20, y: 40, widthPct: 34, zLayer: 'back' },
      center: { x: 50, y: 38, widthPct: 35, zLayer: 'back' },
      right: { x: 78, y: 40, widthPct: 34, zLayer: 'back', defaultFlipX: true },
    },
  },
  {
    id: 'wooden_deck',
    name: 'Oak Patio Deck',
    tagline: 'Sunlit feeding stage',
    category: 'structures',
    sprite: woodenDeckSprite,
    spots: {
      left: { x: 26, y: 53, widthPct: 24, zLayer: 'back' },
      center: { x: 49, y: 52, widthPct: 25, zLayer: 'back' },
      right: { x: 73, y: 53, widthPct: 24, zLayer: 'back' },
    },
  },
  {
    id: 'pond',
    name: 'Cattail Stone Pond',
    tagline: 'Fresh meadow water',
    category: 'nature',
    sprite: pondSprite,
    spots: {
      left: { x: 22, y: 68, widthPct: 28, zLayer: 'front' },
      center: { x: 52, y: 69, widthPct: 28, zLayer: 'front' },
      right: { x: 78, y: 68, widthPct: 28, zLayer: 'front' },
    },
  },
  {
    id: 'hay_bale_large',
    name: 'Giant Hay Roll',
    tagline: 'Golden harvest feed',
    category: 'hay',
    sprite: hayBaleLargeSprite,
    spots: {
      left: { x: 16, y: 50, widthPct: 16, zLayer: 'back' },
      center: { x: 43, y: 48, widthPct: 15, zLayer: 'back' },
      right: { x: 84, y: 50, widthPct: 16, zLayer: 'back', defaultFlipX: true },
    },
  },
  {
    id: 'hay_bale_small_1',
    name: 'Twine Hay Bundle',
    tagline: 'Soft nesting straw',
    category: 'hay',
    sprite: hayBaleSmall1Sprite,
    spots: {
      left: { x: 13, y: 62, widthPct: 13, zLayer: 'front' },
      center: { x: 58, y: 51, widthPct: 12, zLayer: 'back' },
      right: { x: 86, y: 61, widthPct: 13, zLayer: 'front', defaultFlipX: true },
    },
  },
  {
    id: 'hay_bale_small_2',
    name: 'Sunny Hay Bundle',
    tagline: 'Fresh farm bedding',
    category: 'hay',
    sprite: hayBaleSmall2Sprite,
    spots: {
      left: { x: 22, y: 66, widthPct: 12, zLayer: 'front' },
      center: { x: 66, y: 52, widthPct: 12, zLayer: 'back' },
      right: { x: 77, y: 58, widthPct: 12, zLayer: 'back' },
    },
  },
  {
    id: 'fence_long',
    name: 'Long Picket Fence',
    tagline: 'Pasture perimeter',
    category: 'fences',
    sprite: fenceLongSprite,
    spots: {
      left: { x: 30, y: 46, widthPct: 44, zLayer: 'back' },
      center: { x: 52, y: 45, widthPct: 48, zLayer: 'back' },
      right: { x: 72, y: 46, widthPct: 44, zLayer: 'back' },
    },
  },
  {
    id: 'fence_medium',
    name: 'Garden Picket Fence',
    tagline: 'Weathered timber rail',
    category: 'fences',
    sprite: fenceMediumSprite,
    spots: {
      left: { x: 27, y: 48, widthPct: 36, zLayer: 'back' },
      center: { x: 52, y: 47, widthPct: 38, zLayer: 'back' },
      right: { x: 76, y: 47, widthPct: 36, zLayer: 'back' },
    },
  },
  {
    id: 'fence_corner',
    name: 'Corner Picket Gate',
    tagline: 'Cozy meadow corner',
    category: 'fences',
    sprite: fenceCornerSprite,
    spots: {
      left: { x: 14, y: 71, widthPct: 19, zLayer: 'front' },
      center: { x: 48, y: 72, widthPct: 18, zLayer: 'front' },
      right: { x: 86, y: 71, widthPct: 19, zLayer: 'front', defaultFlipX: true },
    },
  },
  {
    id: 'fence_short',
    name: 'Mini Picket Rail',
    tagline: 'Stepping fence post',
    category: 'fences',
    sprite: fenceShortSprite,
    spots: {
      left: { x: 13, y: 57, widthPct: 13, zLayer: 'back' },
      center: { x: 64, y: 48, widthPct: 13, zLayer: 'back' },
      right: { x: 88, y: 63, widthPct: 13, zLayer: 'front', defaultFlipX: true },
    },
  },
  {
    id: 'bush_wide',
    name: 'Mossy Meadow Hedge',
    tagline: 'Lush green shelter',
    category: 'nature',
    sprite: bushWideSprite,
    sway: true,
    spots: {
      left: { x: 17, y: 43, widthPct: 27, zLayer: 'back' },
      center: { x: 46, y: 41, widthPct: 28, zLayer: 'back' },
      right: { x: 80, y: 43, widthPct: 27, zLayer: 'back' },
    },
  },
  {
    id: 'bush_round',
    name: 'Round Clover Shrub',
    tagline: 'Shaded pecking bush',
    category: 'nature',
    sprite: bushRoundSprite,
    sway: true,
    spots: {
      left: { x: 12, y: 44, widthPct: 17, zLayer: 'back' },
      center: { x: 61, y: 42, widthPct: 17, zLayer: 'back' },
      right: { x: 87, y: 44, widthPct: 18, zLayer: 'back' },
    },
  },
  {
    id: 'wildflowers',
    name: 'Daisy Wildflowers',
    tagline: 'Pollen & petals',
    category: 'nature',
    sprite: wildflowersSprite,
    sway: true,
    spots: {
      left: { x: 15, y: 73, widthPct: 15, zLayer: 'front' },
      center: { x: 45, y: 74, widthPct: 15, zLayer: 'front' },
      right: { x: 65, y: 73, widthPct: 15, zLayer: 'front' },
    },
  },
];

export const FARM_ARTIFACT_MAP: Record<FarmArtifactId, FarmArtifactDefinition> = Object.fromEntries(
  FARM_ARTIFACTS.map((item) => [item.id, item]),
) as Record<FarmArtifactId, FarmArtifactDefinition>;

export interface FarmArtifactPresetInfo {
  id: FarmArtifactPresetId;
  name: string;
  subtitle: string;
}

export const FARM_ARTIFACT_PRESETS: FarmArtifactPresetInfo[] = [
  { id: 'homestead', name: 'Cozy Homestead', subtitle: 'Barn, pond, fence & hay' },
  { id: 'pondside', name: 'Pondside Garden', subtitle: 'Water, daisies & shrubs' },
  { id: 'ranch', name: 'Full Harvest Ranch', subtitle: 'All 13 farm artifacts' },
  { id: 'minimal', name: 'Open Meadow', subtitle: 'Hide placed props' },
];

export function buildPresetLayout(preset: FarmArtifactPresetId): FarmArtifactLayout {
  const baseItems: Record<FarmArtifactId, FarmArtifactItemState> = {
    barn: { enabled: false, spot: 'left', flipped: false },
    wooden_deck: { enabled: false, spot: 'center', flipped: false },
    pond: { enabled: false, spot: 'right', flipped: false },
    hay_bale_large: { enabled: false, spot: 'right', flipped: false },
    hay_bale_small_1: { enabled: false, spot: 'left', flipped: false },
    hay_bale_small_2: { enabled: false, spot: 'left', flipped: false },
    fence_long: { enabled: false, spot: 'center', flipped: false },
    fence_medium: { enabled: false, spot: 'right', flipped: false },
    fence_corner: { enabled: false, spot: 'left', flipped: false },
    fence_short: { enabled: false, spot: 'right', flipped: false },
    bush_wide: { enabled: false, spot: 'right', flipped: false },
    bush_round: { enabled: false, spot: 'left', flipped: false },
    wildflowers: { enabled: false, spot: 'left', flipped: false },
  };

  if (preset === 'homestead') {
    baseItems.barn = { enabled: true, spot: 'left', flipped: false };
    baseItems.fence_long = { enabled: true, spot: 'center', flipped: false };
    baseItems.bush_wide = { enabled: true, spot: 'right', flipped: false };
    baseItems.hay_bale_large = { enabled: true, spot: 'right', flipped: false };
    baseItems.hay_bale_small_1 = { enabled: true, spot: 'left', flipped: false };
    baseItems.wooden_deck = { enabled: true, spot: 'center', flipped: false };
    baseItems.pond = { enabled: true, spot: 'right', flipped: false };
    baseItems.fence_corner = { enabled: true, spot: 'left', flipped: false };
    baseItems.wildflowers = { enabled: true, spot: 'center', flipped: false };
  } else if (preset === 'pondside') {
    baseItems.pond = { enabled: true, spot: 'left', flipped: false };
    baseItems.wildflowers = { enabled: true, spot: 'center', flipped: false };
    baseItems.bush_wide = { enabled: true, spot: 'left', flipped: false };
    baseItems.bush_round = { enabled: true, spot: 'right', flipped: false };
    baseItems.fence_medium = { enabled: true, spot: 'right', flipped: false };
    baseItems.wooden_deck = { enabled: true, spot: 'right', flipped: false };
    baseItems.fence_short = { enabled: true, spot: 'left', flipped: false };
  } else if (preset === 'ranch') {
    (Object.keys(baseItems) as FarmArtifactId[]).forEach((id) => {
      baseItems[id].enabled = true;
    });
    baseItems.barn.spot = 'left';
    baseItems.bush_round.spot = 'left';
    baseItems.bush_wide.spot = 'right';
    baseItems.fence_long.spot = 'center';
    baseItems.fence_medium.spot = 'right';
    baseItems.fence_corner.spot = 'left';
    baseItems.fence_short.spot = 'right';
    baseItems.wooden_deck.spot = 'center';
    baseItems.hay_bale_large.spot = 'right';
    baseItems.hay_bale_small_1.spot = 'left';
    baseItems.hay_bale_small_2.spot = 'left';
    baseItems.pond.spot = 'right';
    baseItems.wildflowers.spot = 'center';
  }

  return { preset, items: baseItems };
}

function getStorageKey(uid: string): string {
  return `chickenland_farm_artifacts_v1_${uid || 'guest'}`;
}

export function loadFarmArtifactLayout(uid: string): FarmArtifactLayout {
  const fallback = buildPresetLayout('homestead');
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<FarmArtifactLayout> | null;
    if (!parsed || typeof parsed !== 'object' || !parsed.items) return fallback;

    const validPresets: FarmArtifactPresetId[] = ['homestead', 'pondside', 'ranch', 'minimal'];
    const preset: FarmArtifactPresetId =
      parsed.preset && validPresets.includes(parsed.preset) ? parsed.preset : 'homestead';

    const merged = buildPresetLayout('homestead');
    merged.preset = preset;
    for (const def of FARM_ARTIFACTS) {
      const savedItem = parsed.items[def.id];
      if (savedItem && typeof savedItem === 'object') {
        const spot: FarmArtifactSlot =
          savedItem.spot === 'left' || savedItem.spot === 'center' || savedItem.spot === 'right'
            ? savedItem.spot
            : merged.items[def.id].spot;
        merged.items[def.id] = {
          enabled: typeof savedItem.enabled === 'boolean' ? savedItem.enabled : merged.items[def.id].enabled,
          spot,
          flipped: Boolean(savedItem.flipped),
        };
      }
    }
    return merged;
  } catch {
    return fallback;
  }
}

export function saveFarmArtifactLayout(uid: string, layout: FarmArtifactLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getStorageKey(uid), JSON.stringify(layout));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

export function countEnabledFarmArtifacts(layout: FarmArtifactLayout): number {
  return FARM_ARTIFACTS.reduce((sum, def) => sum + (layout.items[def.id]?.enabled ? 1 : 0), 0);
}
