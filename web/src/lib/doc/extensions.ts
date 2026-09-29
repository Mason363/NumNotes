// Tiptap setup shared by the document editor and slide/canvas text boxes.

import { type Extensions, mergeAttributes, Node } from '@tiptap/core';
import { Highlight } from '@tiptap/extension-highlight';
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table';
import { TextAlign } from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';
import { assets } from '../state/assets.ts';

/** A picture from the asset store, laid out as a block. */
export const Picture = Node.create({
  name: 'picture',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      asset: { default: null },
      width: { default: 100 },
      align: { default: 'center' },
      caption: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-asset]',
        getAttrs: (el) => ({
          asset: (el as HTMLElement).dataset.asset,
          width: Number((el as HTMLElement).dataset.width ?? 100),
          caption: (el as HTMLElement).querySelector('figcaption')?.textContent ?? '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-asset': node.attrs.asset, 'data-width': node.attrs.width }),
      ['img', { src: assets.url(node.attrs.asset) ?? '', alt: node.attrs.caption }],
      ['figcaption', {}, node.attrs.caption ?? ''],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const figure = document.createElement('figure');
      figure.className = 'nn-picture';
      figure.dataset.align = node.attrs.align;
      const img = document.createElement('img');
      img.src = assets.url(node.attrs.asset) ?? '';
      img.style.width = `${node.attrs.width}%`;
      img.draggable = false;
      figure.append(img);
      if (node.attrs.caption) {
        const cap = document.createElement('figcaption');
        cap.textContent = node.attrs.caption;
        figure.append(cap);
      }
      return { dom: figure };
    };
  },
});

/** A LaTeX formula, rendered to a picture when the app is built. */
export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return { latex: { default: '' } };
  },

  parseHTML() {
    return [{ tag: 'div[data-latex]', getAttrs: (el) => ({ latex: (el as HTMLElement).dataset.latex }) }];
  },

  renderHTML({ node }) {
    return ['div', { 'data-latex': node.attrs.latex }, node.attrs.latex];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'nn-math';
      const preview = document.createElement('div');
      preview.className = 'nn-math-preview';
      const input = document.createElement('input');
      input.className = 'nn-math-input';
      input.placeholder = 'LaTeX, e.g. \\frac{a}{b} or x^2 + y^2 = r^2';
      input.spellcheck = false;
      dom.append(preview, input);
      let latex = node.attrs.latex as string;
      const render = () => {
        preview.textContent = latex || 'Formula';
        import('./math.ts').then(({ mathSvg }) =>
          mathSvg(latex).then((svg) => {
            if (svg && latex) preview.innerHTML = svg;
          }),
        );
      };
      render();
      input.value = latex;
      input.addEventListener('input', () => {
        const pos = typeof getPos === 'function' ? getPos() : undefined;
        if (pos === undefined) return;
        editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { latex: input.value }));
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          editor.commands.focus();
        }
      });
      return {
        dom,
        update: (next) => {
          if (next.type.name !== 'mathBlock') return false;
          if (next.attrs.latex !== latex) {
            latex = next.attrs.latex;
            if (document.activeElement !== input) input.value = latex;
            render();
          }
          return true;
        },
        selectNode: () => {
          dom.classList.add('editing');
          setTimeout(() => {
            input.focus();
            input.select();
          }, 0);
        },
        deselectNode: () => dom.classList.remove('editing'),
        stopEvent: (e) => e.target === input,
        ignoreMutation: () => true,
      };
    };
  },
});

/** Table cells keep a background color (class schedules!). */
const cellColor = {
  backgroundColor: {
    default: null,
    parseHTML: (el: HTMLElement) => el.style.backgroundColor || el.dataset.background || null,
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
  },
};

const ColoredCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellColor };
  },
});

const ColoredHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellColor };
  },
});

export function richExtensions(placeholder = 'Start typing…'): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: { openOnClick: false },
    }),
    TextStyleKit.configure({ lineHeight: false }),
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TableKit.configure({ table: { resizable: true, cellMinWidth: 24 }, tableCell: false, tableHeader: false }),
    ColoredCell,
    ColoredHeader,
    Placeholder.configure({ placeholder }),
    Picture,
    MathBlock,
  ];
}
