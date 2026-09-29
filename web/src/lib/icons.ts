// Lucide icons matching the calculator's home-screen icons.
import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  FileText,
  FlaskConical,
  Heart,
  Images,
  Move,
  Music,
  PenLine,
  Presentation,
  Star,
} from '@lucide/svelte';
import type { IconName } from '../pack/format.ts';
import type { SectionMode } from '../model/types.ts';

export const SECTION_ICONS: Record<IconName, typeof Star> = {
  slides: Presentation,
  document: FileText,
  canvas: Move,
  gallery: Images,
  notes: PenLine,
  calendar: CalendarDays,
  star: Star,
  book: BookOpen,
  flask: FlaskConical,
  chart: ChartColumn,
  heart: Heart,
  music: Music,
};

export const MODE_INFO: Record<SectionMode, { label: string; description: string; icon: IconName }> = {
  slides: { label: 'Slides', description: 'One screen at a time', icon: 'slides' },
  document: { label: 'Document', description: 'Scrolling text, tables, pictures', icon: 'document' },
  canvas: { label: 'Canvas', description: 'A big board to pan and zoom', icon: 'canvas' },
  gallery: { label: 'Gallery', description: 'Picture grid, opens full screen', icon: 'gallery' },
  notes: { label: 'Notes', description: 'Typed on the calculator', icon: 'notes' },
};
