<script lang="ts">
  import type { AppSettings, Theme } from '../../../model/types.ts';
  import { FAMILY_LABELS } from '../../../pack/fonts.ts';
  import ColorInput from '../../ui/ColorInput.svelte';
  import Field from '../../ui/Field.svelte';
  import Segmented from '../../ui/Segmented.svelte';
  import Toggle from '../../ui/Toggle.svelte';
  import { THEMES } from '../../state/defaults.ts';
  import { store } from '../../state/project.svelte.ts';

  const project = $derived(store.project!);
  let advanced = $state(false);

  const setTheme = (patch: Partial<Theme>) => store.edit((p) => Object.assign(p.theme, patch), 'theme');
  const setSetting = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => store.edit((p) => (p.settings[k] = v));

  const PRESETS: { id: keyof typeof THEMES; label: string }[] = [
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'sepia', label: 'Paper' },
    { id: 'contrast', label: 'High contrast' },
  ];
</script>

<div class="panel">
  <Field label="Look">
    <div class="presets">
      {#each PRESETS as p (p.id)}
        {@const t = THEMES[p.id]}
        <button
          class="preset"
          class:on={project.theme.preset === p.id}
          style="background: {t.background}; color: {t.text}"
          onclick={() => setTheme({ preset: p.id, background: t.background, text: t.text, accent: project.theme.preset === 'custom' ? project.theme.accent : project.theme.accent })}
        >
          <span class="bar" style="background: {project.theme.accent}"></span>
          <span>{p.label}</span>
        </button>
      {/each}
    </div>
  </Field>
  <Field label="Accent">
    <ColorInput value={project.theme.accent} swatches={['#f28c28', '#e5484d', '#d6409f', '#8e4ec6', '#3f6ff5', '#0091c2', '#2fa84f', '#c79a00', '#1c1c1f']} onchange={(c) => c && setTheme({ accent: c })} />
  </Field>
  <Field label="Font">
    <select class="text" value={project.theme.font} onchange={(e) => setTheme({ font: (e.currentTarget as HTMLSelectElement).value as Theme['font'] })}>
      {#each Object.entries(FAMILY_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
    </select>
  </Field>
  <button class="disclosure" onclick={() => (advanced = !advanced)} aria-expanded={advanced}>{advanced ? '▾' : '▸'} Custom colors</button>
  {#if advanced}
    <Field label="Background"><ColorInput value={project.theme.background} onchange={(c) => c && setTheme({ preset: 'custom', background: c })} /></Field>
    <Field label="Text"><ColorInput value={project.theme.text} onchange={(c) => c && setTheme({ preset: 'custom', text: c })} /></Field>
  {/if}

  <h3>Calculator</h3>
  <Field label="Opens to">
    <Segmented
      value={project.settings.start}
      small
      options={[
        { value: 'home', label: 'Home' },
        { value: 'first', label: 'First' },
        { value: 'resume', label: 'Last place' },
      ]}
      onchange={(v) => setSetting('start', v)}
    />
  </Field>
  <Field label="Calculator notes" inline>
    <Toggle checked={project.settings.notes} onchange={(v) => setSetting('notes', v)} />
  </Field>
  <Field label="Search" inline><Toggle checked={project.settings.search} onchange={(v) => setSetting('search', v)} /></Field>
  <Field label="Bookmarks" inline><Toggle checked={project.settings.bookmarks} onchange={(v) => setSetting('bookmarks', v)} /></Field>
  <Field label="Battery" inline><Toggle checked={project.settings.battery} onchange={(v) => setSetting('battery', v)} /></Field>
  <Field label="Key hints" inline><Toggle checked={project.settings.hints} onchange={(v) => setSetting('hints', v)} /></Field>
</div>

<style>
  .panel {
    display: grid;
    gap: 14px;
  }
  h3 {
    font-size: 13px;
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 6px;
  }
  .presets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    width: 100%;
  }
  .preset {
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    padding: 0 0 8px;
    overflow: hidden;
    display: grid;
    gap: 6px;
    font-size: 12.5px;
    font-weight: 600;
  }
  .preset.on {
    box-shadow: 0 0 0 2px var(--panel), 0 0 0 4px var(--accent);
  }
  .bar {
    height: 8px;
  }
  .text {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 2px;
    padding: 6px 8px;
    background: var(--panel);
    font-size: 13px;
  }
  .disclosure {
    border: none;
    background: transparent;
    text-align: left;
    padding: 2px 0;
    font-weight: 560;
    color: var(--dim);
  }
</style>
