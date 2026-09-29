// Starting points offered on the welcome screen.

import type { CanvasSection, DocumentSection, NotesSection, Project, SlidesSection } from '../../model/types.ts';
import { bold, doc, h, newProject, newSection, newSlide, p, table, textItem, ul } from './defaults.ts';

export interface Template {
  id: string;
  title: string;
  description: string;
  create(): Project;
}

const SUBJECTS: Record<string, string> = {
  Chemistry: '#ffe1e1',
  Calculus: '#dcebff',
  English: '#e2f7dc',
  History: '#fff1cc',
  Physics: '#ebe1ff',
  Spanish: '#ffe2f2',
  Lunch: '#efeff2',
  Biology: '#d9f5f0',
  Art: '#fde6d4',
};

const TIMES = ['8:00', '9:05', '10:10', '11:15', '12:20', '1:05', '2:10'];
const WEEK: Record<string, string[]> = {
  Monday: ['Chemistry', 'Calculus', 'English', 'History', 'Lunch', 'Physics', 'Spanish'],
  Tuesday: ['Calculus', 'Biology', 'English', 'Art', 'Lunch', 'Chemistry', 'History'],
  Wednesday: ['Chemistry', 'Calculus', 'Spanish', 'History', 'Lunch', 'Physics', 'English'],
  Thursday: ['Calculus', 'Biology', 'English', 'Art', 'Lunch', 'Chemistry', 'Spanish'],
  Friday: ['Physics', 'Calculus', 'English', 'History', 'Lunch', 'Biology', 'Art'],
};
const ROOMS: Record<string, string> = {
  Chemistry: 'Lab 2',
  Calculus: 'A14',
  English: 'C7',
  History: 'D2',
  Physics: 'Lab 1',
  Spanish: 'C4',
  Lunch: '-',
  Biology: 'Lab 3',
  Art: 'E1',
};

function schedule(): Project {
  const project = newProject('Schedule');
  project.icon = { kind: 'glyph', glyph: 'Wk', background: '#3f6ff5', color: '#ffffff' };
  project.theme.accent = '#3f6ff5';

  const days = newSection('slides', 'By day', 0) as SlidesSection;
  days.icon = 'calendar';
  days.statusBar = true;
  days.slides = Object.entries(WEEK).map(([day, classes]) => {
    const rows = [['Time', 'Class', 'Room'], ...classes.map((c, i) => [TIMES[i], c, ROOMS[c]])];
    const colors = rows.map((row, r) => (r === 0 ? [undefined, undefined, undefined] : [undefined, SUBJECTS[row[1]], undefined]));
    return newSlide([textItem(6, 2, 308, 216, doc(h(2, day), table(rows, { header: true, colors })), { padding: 4, radius: 0, fontSize: 12 })], day);
  });

  const week = newSection('canvas', 'Whole week', 1) as CanvasSection;
  week.icon = 'chart';
  week.width = 720;
  week.height = 380;
  const header = ['', ...Object.keys(WEEK).map((d) => d.slice(0, 3))];
  const rows = [header, ...TIMES.map((t, i) => [t, ...Object.values(WEEK).map((classes) => classes[i])])];
  const colors = rows.map((row, r) => row.map((cell, c) => (r > 0 && c > 0 ? SUBJECTS[cell] : undefined)));
  week.items = [
    textItem(20, 16, 680, 36, doc(h(1, 'Week at a glance')), { padding: 2, radius: 0 }),
    { ...textItem(20, 60, 680, 300, doc(table(rows, { header: true, colors })), { padding: 0, radius: 0, fontSize: 15 }), stop: true },
  ];

  const homework = newSection('notes', 'Homework', 2) as NotesSection;
  homework.notes = ['Chemistry\nFinish the titration lab report', 'Calculus\np. 214, #1-19 odd'];

  project.sections = [days, week, homework];
  project.settings.start = 'home';
  return project;
}

function reference(): Project {
  const project = newProject('Formulas');
  project.icon = { kind: 'glyph', glyph: 'Σ', background: '#2e8b3d', color: '#ffffff' };
  const sheet = newSection('document', 'Formula sheet', 1) as DocumentSection;
  sheet.doc = doc(
    h(1, 'Formula sheet'),
    h(2, 'Light'),
    p(bold('Energy of a photon: '), 'E = hf = hc / λ'),
    p(bold('Speed of light: '), 'c = 3.00 × 10⁸ m/s'),
    table(
      [
        ['Color', 'Wavelength'],
        ['Red', '620-750 nm'],
        ['Green', '495-570 nm'],
        ['Blue', '450-495 nm'],
        ['Violet', '380-450 nm'],
      ],
      { header: true, colors: [[], ['#ffd6d6'], ['#d8f5d0'], ['#d4e4ff'], ['#e8dcff']] },
    ),
    h(2, 'Gases'),
    p(bold('Ideal gas law: '), 'PV = nRT'),
    p(bold('R = '), '8.314 J/(mol·K)'),
  );
  project.sections = [sheet, newSection('notes', 'Notes', 2)];
  project.settings.start = 'first';
  return project;
}

function album(): Project {
  const project = newProject('Photos');
  project.icon = { kind: 'glyph', glyph: 'Ph', background: '#1f1f1f', color: '#ffb734' };
  project.theme = { ...project.theme, preset: 'dark', background: '#131316', text: '#ececf0', accent: '#ffb23f' };
  project.sections = [newSection('gallery', 'Photos', 2)];
  project.settings.start = 'first';
  return project;
}

function presentation(): Project {
  const project = newProject('Slides');
  project.icon = { kind: 'glyph', glyph: 'Sl', background: '#8e4ec6', color: '#ffffff' };
  const deck = newSection('slides', 'Presentation', 3) as SlidesSection;
  deck.slides = [
    newSlide(
      [
        textItem(20, 70, 280, 60, doc({ ...h(1, 'Big idea'), attrs: { level: 1, textAlign: 'center' } }), { valign: 'middle' }),
        textItem(20, 130, 280, 40, doc({ ...p('A short subtitle'), attrs: { textAlign: 'center' } })),
      ],
      'Title',
    ),
    newSlide([textItem(16, 16, 288, 208, doc(h(2, 'Three points'), ul('First thing to remember', 'Second thing', 'Third thing')))], 'Points'),
  ];
  project.sections = [deck];
  project.settings.start = 'first';
  return project;
}

function board(): Project {
  const project = newProject('Board');
  project.icon = { kind: 'glyph', glyph: 'Bd', background: '#0091c2', color: '#ffffff' };
  const canvas = newSection('canvas', 'Board', 5) as CanvasSection;
  canvas.items = [
    textItem(60, 60, 260, 120, doc(h(2, 'Pan and zoom'), p('Arrows move around, + and − zoom, OK flies to the next spot.')), { background: '#fff3c4', padding: 10, stop: true }),
    textItem(420, 300, 260, 120, doc(h(2, 'Drop anything'), p('Pictures, text and shapes go anywhere on the board.')), { background: '#dff3ff', padding: 10, stop: true }),
  ];
  project.sections = [canvas];
  project.settings.start = 'first';
  return project;
}

function blank(): Project {
  const project = newProject('My Notes');
  project.sections = [newSection('document', 'Notes', 1)];
  return project;
}

export const TEMPLATES: Template[] = [
  { id: 'blank', title: 'Blank', description: 'Empty document', create: blank },
  { id: 'schedule', title: 'Class schedule', description: 'Day slides and a week view', create: schedule },
  { id: 'reference', title: 'Reference sheet', description: 'Formulas and tables', create: reference },
  { id: 'album', title: 'Photo album', description: 'Picture grid', create: album },
  { id: 'presentation', title: 'Presentation', description: 'Slides', create: presentation },
  { id: 'board', title: 'Board', description: 'One big canvas', create: board },
];
