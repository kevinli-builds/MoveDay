// Furniture types the manager offers — value strings and default footprints
// mirror Furnisher's FURNITURE_META (lib/furniture.ts there) so staged pieces
// get the right top-view glyph on handoff. Dimensions in cm, canonical.

export interface FurnTypeDef {
  value: string
  label: string
  w: number // default footprint width (cm)
  h: number // default footprint depth (cm)
}

export const FURN_TYPES: FurnTypeDef[] = [
  { value: 'sofa', label: 'Sofa', w: 200, h: 90 },
  { value: 'bed', label: 'Bed', w: 150, h: 200 },
  { value: 'chair', label: 'Chair', w: 50, h: 50 },
  { value: 'diningTable', label: 'Dining table', w: 160, h: 90 },
  { value: 'table', label: 'Coffee table', w: 110, h: 60 },
  { value: 'desk', label: 'Desk', w: 140, h: 70 },
  { value: 'dresser', label: 'Dresser', w: 100, h: 45 },
  { value: 'wardrobe', label: 'Wardrobe', w: 120, h: 60 },
  { value: 'nightstand', label: 'Nightstand', w: 45, h: 40 },
  { value: 'bookshelf', label: 'Bookshelf', w: 90, h: 30 },
  { value: 'rug', label: 'Rug', w: 200, h: 140 },
  { value: 'tv', label: 'TV / console', w: 120, h: 25 },
  { value: 'fridge', label: 'Fridge', w: 70, h: 70 },
  { value: 'box', label: 'Other', w: 60, h: 60 },
]

// A small varied palette (hex only — passes safeColor) for telling pieces apart.
export const FURN_COLORS = ['#3d6b9e', '#4a7c59', '#b5714e', '#8a5fbf', '#c9a87c', '#6b7280']
