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
      <button class="close" onclick={() => (open = false)}>Close</button>
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
    border: 1px solid var(--line-strong);
    background: var(--panel);
    border-radius: var(--radius-sm);
    height: 30px;
    padding: 0 8px;
  }
  .meter:hover {
    background: var(--hover);
  }
  .bar {
    width: 70px;
    height: 8px;
    border: 1px solid var(--line-strong);
    background: var(--panel-2);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--text);
  }
  .fill.high {
    background: var(--accent-strong);
  }
  .fill.over {
    background: var(--danger);
  }
  .text {
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .of {
    color: var(--faint);
  }
  .spinner {
    width: 8px;
    height: 8px;
    background: var(--accent);
    animation: blink 0.8s steps(2) infinite;
  }
  @keyframes blink {
    to {
      opacity: 0;
    }
  }
  .pop {
    position: absolute;
    right: 0;
    top: calc(100% + 2px);
    width: 290px;
    z-index: 40;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg);
    padding: 12px 14px;
    display: grid;
    gap: 8px;
  }
  h3 {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  h4 {
    font-size: 11px;
    color: var(--dim);
    margin-top: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 2px;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    font-size: 12.5px;
    border-bottom: 1px dotted var(--line);
    padding: 2px 0;
  }
  dt {
    color: var(--dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    font-family: var(--mono);
    font-size: 11.5px;
  }
  .close {
    justify-self: end;
    border: 1px solid var(--line-strong);
    background: var(--panel);
    padding: 3px 10px;
    font-size: 12px;
  }
  @media (max-width: 760px) {
    .bar {
      display: none;
    }
  }
</style>
