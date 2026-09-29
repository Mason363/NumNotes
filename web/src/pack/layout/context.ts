// Shared state while laying out one bundle: fonts, pictures and the
// primitives/items of the scene being built.

import type { FontFamily, ImageRef } from '../../model/types.ts';
import type { FontSet, FontSpec, PackFont } from '../fonts.ts';
import type { PackedItem, Prim, SearchEntry } from '../format.ts';

export interface ThemeColors {
  bg: string;
  fg: string;
  dim: string;
  accent: string;
  line: string;
  codeBg: string;
  highlight: string;
  tableHeader: string;
}

export interface PictureRequest {
  ref: ImageRef;
  /** Size in the scene at zoom 1. */
  w: number;
  h: number;
  /** Crop override (e.g. for cover-fit), in source fractions. */
  cover?: { x: number; y: number; w: number; h: number };
  background: string;
  radius?: number;
  keepAlpha?: boolean;
  /** Skip zoom detail (thumbnails). */
  noDetail?: boolean;
  /** Also keep a half-size copy for zoomed-out views (canvases). */
  zoomOut?: boolean;
}

export interface PictureResult {
  kind: 'image' | 'anim';
  index: number;
  /** Source size, for aspect ratios. */
  width: number;
  height: number;
}

/** Implemented by the bundle builder; resolves pictures synchronously from
 * pre-encoded caches (the builder encodes everything up front). */
export interface PictureSource {
  natural(asset: string): { width: number; height: number; animated: boolean } | undefined;
  request(req: PictureRequest): PictureResult | undefined;
}

export interface MathSource {
  get(latex: string, display: boolean): { asset: string; width: number; height: number } | undefined;
}

export class SceneBuilder {
  prims: Prim[] = [];
  items: PackedItem[] = [];
  search: Omit<SearchEntry, 'section' | 'scene'>[] = [];
}

export class LayoutContext {
  fonts: FontSet;
  pictures: PictureSource;
  math?: MathSource;
  theme: ThemeColors;
  sectionIds: Map<string, number>;

  constructor(fonts: FontSet, pictures: PictureSource, theme: ThemeColors, sectionIds: Map<string, number>, math?: MathSource) {
    this.fonts = fonts;
    this.pictures = pictures;
    this.theme = theme;
    this.sectionIds = sectionIds;
    this.math = math;
  }

  font(family: FontFamily, size: number, bold = false, italic = false): { index: number; face: PackFont } {
    const spec: FontSpec = { family, size, bold, italic };
    return this.fonts.get(spec);
  }
}
