<script lang="ts">
  import { build, formatBytes } from '../state/build.svelte.ts';
  import { store } from '../state/project.svelte.ts';

  let open = $state(false);
  const used = $derived(build.appBytes);
  const pct = $derived(Math.min(100, (used / build.capacity) * 100));
  const level = $derived(pct > 100 ? 'over' : pct > 85 ? 'high' : 'ok');
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
    {#if build.building}<span class="spinner" aria-label="Building"></span>{/if}
  </button>
  {#if open}
    <div class="pop" role="dialog">
      <h3>Calculator space</h3>
      <p class="muted small">{build.capacityKnown ? `${formatBytes(build.capacity)} for apps.` : `About ${formatBytes(build.capacity)} for apps. Exact once connected.`}</p>
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
    border-radius: var(--pill);
    height: 32px;
    padding: 0 10px;
  }
  .meter:hover {
    background: var(--layout);
  }
  .bar {
    width: 72px;
    height: 6px;
    border-radius: 3px;
    background: var(--card);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--purple);
  }
  .fill.high {
    background: var(--accent);
  }
  .fill.over {
    background: var(--danger);
  }
  .text {
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
    font-variant-numeric: tabular-nums;
  }
  .of {
    color: var(--faint);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--card);
    border-top-color: var(--purple);
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
    width: 290px;
    z-index: 40;
    background: var(--panel);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 14px 16px;
    display: grid;
    gap: 8px;
  }
  h3 {
    font-size: 16px;
    font-weight: 600;
  }
  h4 {
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
    margin-top: 4px;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 2px;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    padding: 3px 0;
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
    font-weight: 700;
    color: var(--label);
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
