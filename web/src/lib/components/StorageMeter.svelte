<script lang="ts">
  import { build, formatBytes } from '../state/build.svelte.ts';
  import { store } from '../state/project.svelte.ts';

  let open = $state(false);
  const used = $derived(build.appBytes);
  const pct = $derived(Math.min(100, (used / build.capacity) * 100));
  const level = $derived(build.tooBig ? 'over' : pct > 85 ? 'high' : 'ok');
  const SHRINK_NAMES = ['', 'a little', 'a lot', 'as much as possible'];
  const sections = $derived(
    (build.stats?.sections ?? [])
      .map((s) => ({ ...s, title: store.project?.sections.find((x) => x.id === s.id)?.title ?? '' }))
      .filter((s) => s.title),
  );
</script>

<div class="meter-root">
  <button class="meter" onclick={() => (open = !open)} title="How much space the app takes on the calculator">
    <span class="bar"><span class="fill {level}" style="width: {Math.max(pct, 2)}%"></span></span>
    <span class="text">
      {#if build.building && !used}Building…{:else}{formatBytes(used)}<span class="of"> / {build.capacityKnown ? '' : '~'}{formatBytes(build.capacity)}</span>{/if}
    </span>
    {#if build.autoShrink && !build.building}<span class="shrunk" title="Pictures were shrunk to fit">Shrunk</span>{/if}
    {#if build.building}<span class="spinner" aria-label="Building"></span>{/if}
  </button>
  {#if open}
    <div class="pop" role="dialog">
      <h3>Calculator space</h3>
      <p class="muted small">{build.capacityKnown ? `${formatBytes(build.capacity)} for apps.` : `About ${formatBytes(build.capacity)} for apps. Exact once connected.`}</p>
      {#if build.tooBig}
        <p class="warn">Too big for the calculator. Shrink pictures in a section's settings, or remove some.</p>
      {:else if build.autoShrink}
        <p class="note">Pictures were shrunk {SHRINK_NAMES[build.autoShrink]} to fit. Turn this off in App settings.</p>
      {/if}
      <dl>
        <div><dt>App & text</dt><dd>{formatBytes(Math.max(0, used - (build.stats?.images ?? 0) - 65536))}</dd></div>
        <div><dt>Pictures</dt><dd>{formatBytes(build.stats?.images ?? 0)}</dd></div>
        <div><dt>Saved notes</dt><dd>64 KB</dd></div>
      </dl>
      {#if sections.some((s) => s.bytes > 0)}
        <h4>Pictures per section</h4>
        <dl>
          {#each sections as s (s.id)}
            <div><dt>{s.title}</dt><dd>{formatBytes(Math.round(s.bytes))}</dd></div>
          {/each}
        </dl>
      {/if}
      <button class="text-link close" onclick={() => (open = false)}>Close</button>
    </div>
  {/if}
</div>

<style>
  .meter-root {
    position: relative;
  }
  .meter {
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    background: transparent;
    border-radius: var(--radius-sm);
    height: 30px;
    padding: 0 8px;
  }
  .meter:hover {
    background: var(--hover);
  }
  .bar {
    width: 72px;
    height: 6px;
    border-radius: 3px;
    background: #e3e3e3;
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--dim);
  }
  .fill.high {
    background: var(--accent);
  }
  .fill.over {
    background: var(--danger);
  }
  .text {
    font-size: 12px;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .of {
    color: var(--dim);
  }
  .shrunk {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #e3e3e3;
    border-top-color: var(--dim);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    width: 300px;
    z-index: 40;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 12px 14px;
    display: grid;
    gap: 8px;
  }
  h3 {
    font-size: 14px;
    font-weight: 600;
  }
  h4 {
    font-size: 12px;
    font-weight: 600;
    color: var(--dim);
    margin-top: 4px;
  }
  .warn,
  .note {
    font-size: 12px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
  }
  .warn {
    background: #fdecea;
    color: #a3261d;
  }
  .note {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  dl {
    margin: 0;
    display: grid;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
  }
  dt {
    color: var(--dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .close {
    justify-self: end;
  }
  @media (max-width: 760px) {
    .bar {
      display: none;
    }
  }
</style>
