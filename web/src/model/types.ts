// The project a user edits on the website. Everything here is plain JSON so
// it can be saved, undone and exported; binary data lives in the asset store.

import type { IconName } from '../pack/format.ts';

export type FontFamily = 'inter' | 'atkinson' | 'lora' | 'mono' | 'system';
export type SectionMode = 'slides' | 'document' | 'canvas' | 'gallery' | 'notes';

/** ProseMirror/Tiptap JSON. */
export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface ImageAdjust {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  sharpen: number; // 0..100
  grayscale: boolean;
  invert: boolean;
  rotate: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
}

export type QualityMode = 'auto' | 'crisp' | 'photo' | 'compact';

export interface ImageQuality {
  mode: QualityMode;
  /** DCT quality for photos (1..100). */
  level: number;
  /** Max palette size for crisp images. */
  colors: number;
  dither: boolean;
  /** Extra resolution kept for zooming in (1 = none). */
  zoomDetail: 1 | 2 | 3 | 4;
}

export interface Crop {
  x: number; // fractions of the source (0..1)
  y: number;
  w: number;
  h: number;
}

export interface ImageRef {
  asset: string;
  crop?: Crop;
  adjust: ImageAdjust;
  quality: ImageQuality;
  caption?: string;
}

interface ItemBase {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Canvas: a place the calculator can fly to with OK. */
  stop?: boolean;
  /** Slides: selecting this item on the calculator jumps to a section. */
  link?: string;
  locked?: boolean;
}

export type ImageFit = 'contain' | 'cover' | 'fill';

export interface ImageItem extends ItemBase, ImageRef {
  type: 'image';
  fit: ImageFit;
  radius: number;
  border?: { color: string; width: number };
}

export interface TextItem extends ItemBase {
  type: 'text';
  doc: RichNode;
  background?: string;
  radius: number;
  padding: number;
  valign: 'top' | 'middle' | 'bottom';
  font?: FontFamily;
  fontSize?: number;
}

export interface ShapeItem extends ItemBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line' | 'arrow';
  fill?: string;
  stroke?: string;
  strokeWidth: number;
  radius: number;
}

export type Item = ImageItem | TextItem | ShapeItem;

export interface Slide {
  id: string;
  background?: string;
  items: Item[];
  title?: string;
}

interface SectionBase {
  id: string;
  title: string;
  subtitle?: string;
  icon: IconName;
  iconColor: string;
  background?: string;
  hidden?: boolean;
  statusBar: boolean;
}

export interface SlidesSection extends SectionBase {
  mode: 'slides';
  slides: Slide[];
  loop: boolean;
  autoplay: boolean;
  autoplaySeconds: number;
  transition: boolean;
  pageNumbers: boolean;
}

export interface DocumentSection extends SectionBase {
  mode: 'document';
  doc: RichNode;
  font: FontFamily;
  fontSize: number;
  lineHeight: number;
  margin: number;
}

export interface CanvasSection extends SectionBase {
  mode: 'canvas';
  width: number;
  height: number;
  items: Item[];
  minimap: boolean;
  startZoom: number; // 0 = fit everything
  maxZoom: number;
}

export interface GalleryImage extends ImageRef {
  id: string;
}

export interface GallerySection extends SectionBase {
  mode: 'gallery';
  images: GalleryImage[];
  columns: 2 | 3 | 4;
  captionsInViewer: boolean;
  captionsInGrid: boolean;
}

export interface NotesSection extends SectionBase {
  mode: 'notes';
  notes: string[];
}

export type Section = SlidesSection | DocumentSection | CanvasSection | GallerySection | NotesSection;

export interface Theme {
  preset: 'light' | 'dark' | 'sepia' | 'contrast' | 'custom';
  background: string;
  text: string;
  accent: string;
  font: FontFamily;
}

export type IconStyle =
  | { kind: 'glyph'; glyph: string; background: string; background2?: string; color: string }
  | { kind: 'image'; asset: string; crop?: Crop; background: string };

export interface AppSettings {
  start: 'home' | 'first' | 'resume';
  notes: boolean;
  search: boolean;
  bookmarks: boolean;
  battery: boolean;
  hints: boolean;
}

export interface Project {
  version: 1;
  id: string;
  /** Random u32 tying the calculator's saved notes to this project. */
  projectId: number;
  name: string;
  icon: IconStyle;
  theme: Theme;
  settings: AppSettings;
  sections: Section[];
  createdAt: number;
  updatedAt: number;
}

/** Binary content referenced by id from the project. */
export interface AssetMeta {
  id: string;
  kind: 'image' | 'animation';
  name: string;
  width: number;
  height: number;
  hasAlpha: boolean;
  frameCount?: number;
  bytes: number;
}
