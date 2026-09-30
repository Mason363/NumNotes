<script lang="ts">
  import { ChevronRight } from '@lucide/svelte';
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
    <ColorInput value={project.theme.accent} swatches={['#ffb734', '#e5484d', '#d6409f', '#8e4ec6', '#7a81ff', '#3f6ff5', '#0091c2', '#2fa84f', '#1c1c1f']} onchange={(c) => c && setTheme({ accent: c })} />
  </Field>
  <Field label="Font">
    <select class="field-input" value={project.theme.font} onchange={(e) => setTheme({ font: (e.currentTarget as HTMLSelectElement).value as Theme['font'] })}>
      {#each Object.entries(FAMILY_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
    </select>
  </Field>
  <button class="text-link disclosure" onclick={() => (advanced = !advanced)} aria-expanded={advanced}><ChevronRight size={14} strokeWidth={2.5} />Custom colors</button>
  {#if advanced}
    <Field label="Background"><ColorInput value={project.theme.background} onchange={(c) => c && setTheme({ preset: 'custom', background: c })} /></Field>
    <Field label="Text"><ColorInput value={project.theme.text} onchange={(c) => c && setTheme({ preset: 'custom', text: c })} /></Field>
  {/if}

  <h3 class="group-title">Calculator</h3>
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
    gap: 16px;
  }
  h3 {
    margin-top: 8px;
  }
  .presets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    width: 100%;
  }
  .preset {
    border: 2px solid transparent;
    border-radius: var(--radius);
    padding: 0 0 8px;
    overflow: hidden;
    display: grid;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
  }
  .preset.on {
    border-color: var(--accent);
  }
  .bar {
    height: 10px;
  }
  .disclosure {
    justify-self: start;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .disclosure :global(svg) {
    transition: transform 0.15s;
  }
  .disclosure[aria-expanded='true'] :global(svg) {
    transform: rotate(90deg);
  }
</style>
