<script lang="ts">
  import { appSize, linkApp } from '../../nwa/app.ts';
  import {
    Calculator,
    CalculatorError,
    InsufficientSpaceError,
    MockCalculator,
    install,
    planInstall,
    type CalculatorInfo,
    type CalculatorLike,
    type InstallPlan,
    type InstallStage,
    type InstalledApp,
  } from '../../usb/index.ts';
  import Button from '../ui/Button.svelte';
  import Modal from '../ui/Modal.svelte';
  import { build, formatBytes } from '../state/build.svelte.ts';
  import { store } from '../state/project.svelte.ts';

  interface Props {
    open: boolean;
    onclose: () => void;
    ondownload: () => void;
  }
  let { open, onclose, ondownload }: Props = $props();

  type Step = 'intro' | 'connecting' | 'ready' | 'installing' | 'done' | 'error';
  let step = $state<Step>('intro');
  let error = $state('');
  let info = $state<CalculatorInfo | null>(null);
  let apps = $state<InstalledApp[]>([]);
  let plan = $state<InstallPlan | null>(null);
  let agree = $state(false);
  let stage = $state<InstallStage | 'linking'>('linking');
  let fraction = $state(0);
  let calc: CalculatorLike | null = null;
  let nwa: Uint8Array | null = null;

  const supported = typeof navigator !== 'undefined' && 'usb' in navigator;
  const dev = import.meta.env.DEV;
  const project = $derived(store.project!);

  const STAGES: Record<InstallStage | 'linking', string> = {
    linking: 'Preparing the app',
    'preserving-notes': 'Keeping your notes',
    erasing: 'Making room',
    writing: 'Sending to the calculator',
    verifying: 'Checking',
    rebooting: 'Restarting the calculator',
  };

  function reset() {
    step = 'intro';
    error = '';
    info = null;
    apps = [];
    plan = null;
    agree = false;
    fraction = 0;
  }

  $effect(() => {
    if (open) reset();
  });

  function explain(e: unknown): string {
    if (e instanceof InsufficientSpaceError) {
      return `Needs ${formatBytes(e.requiredBytes)}, ${formatBytes(e.availableBytes)} free. Remove other apps or use smaller pictures.`;
    }
    if (e instanceof CalculatorError) {
      switch (e.code) {
        case 'no-device-selected':
          return 'No calculator chosen.';
        case 'connection-failed':
          return 'The calculator is busy. Close other tabs using it (like my.numworks.com) and try again.';
        case 'unsupported-model':
          return 'This calculator (N0100) can’t run third-party apps.';
        default:
          return e.message;
      }
    }
    return (e as Error).message ?? String(e);
  }

  async function connect(mock = false) {
    error = '';
    try {
      calc = mock ? new MockCalculator({ model: 'N0120' }) : await Calculator.request();
      step = 'connecting';
      await calc.open();
      info = await calc.info();
      apps = await calc.listApps();
      build.setCapacity(info.externalAppsFlashEnd - info.externalAppsFlashStart);
      nwa = await build.nwa();
      plan = planInstall(info, apps, project.projectId, appSize(nwa));
      agree = plan.removes.length === 0;
      step = 'ready';
    } catch (e) {
      error = explain(e);
      step = 'error';
    }
  }

  async function run() {
    if (!calc || !plan || !info || !nwa) return;
    step = 'installing';
    stage = 'linking';
    fraction = 0;
    try {
      const ramStart = info.externalAppsRamStart ?? info.sramStart;
      const ramEnd = info.externalAppsRamEnd ?? info.sramStart + 0x30000;
      const linked = linkApp(nwa, { flashStart: plan.address, ramStart, ramEnd, imageSize: plan.imageSize });
      await install(calc, plan, linked.image, {
        preserveStore: true,
        onProgress: (s, f) => {
          stage = s;
          fraction = f;
        },
      });
      step = 'done';
    } catch (e) {
      error = explain(e);
      step = 'error';
    }
  }

  function icon(app: InstalledApp): string | null {
    if (!app.iconRgba) return null;
    const c = document.createElement('canvas');
    c.width = 55;
    c.height = 56;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(app.iconRgba), 55, 56), 0, 0);
    return c.toDataURL();
  }

  function status(app: InstalledApp): string {
    if (!plan) return '';
    if (plan.replaces?.address === app.address) return 'Will be updated';
    if (plan.removes.some((r) => r.address === app.address)) return 'Will be removed';
    return '';
  }
</script>

<Modal title="Send to calculator" {open} onclose={step === 'installing' ? () => {} : onclose} width={540}>
  {#if !supported}
    <div class="stack">
      <p>Direct install needs Chrome or Edge. Install it this way instead:</p>
      <ol>
        <li>Download the app file.</li>
        <li>Open <a href="https://my.numworks.com/apps" target="_blank" rel="noreferrer">my.numworks.com/apps</a> and add the file.</li>
      </ol>
      <div><Button variant="primary" onclick={ondownload}>Download {project.name}.nwa</Button></div>
    </div>
  {:else if step === 'intro'}
    <div class="stack">
      <ol class="steps">
        <li>Plug in the calculator and turn it on.</li>
        <li>Click Connect and choose “NumWorks Calculator”.</li>
      </ol>
      <p class="muted small">Other apps stay. Updating keeps notes typed on the calculator.</p>
    </div>
  {:else if step === 'connecting'}
    <div class="center"><span class="spinner"></span><p>Reading…</p></div>
  {:else if step === 'ready' && info && plan}
    <div class="stack">
      <div class="calc-card">
        <div>
          <strong>NumWorks {info.model}</strong>
          <span class="muted small">Software {info.firmwareVersion} · {formatBytes(info.externalAppsFlashEnd - info.externalAppsFlashStart)} for apps</span>
        </div>
      </div>
      {#if apps.length}
        <div>
          <h4>On the calculator</h4>
          <ul class="apps">
            {#each apps as app (app.address)}
              {@const src = icon(app)}
              {@const note = status(app)}
              <li class:removed={note === 'Will be removed'}>
                {#if src}<img {src} alt="" />{:else}<span class="ph"></span>{/if}
                <span class="name">{app.name}</span>
                <span class="size muted small">{formatBytes(app.size)}</span>
                {#if note}<span class="badge" class:warn={note === 'Will be removed'}>{note}</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      <p>
        {project.name}: {formatBytes(plan.imageSize)}. Free after: {formatBytes(plan.freeBytesAfter)}.
      </p>
      {#if plan.removes.length}
        <div class="warning">
          <div>
            <p>This version no longer fits in place. {plan.removes.length === 1 ? 'One app' : `${plan.removes.length} apps`} after it will be removed.</p>
            <label class="agree"><input type="checkbox" bind:checked={agree} /> Remove {plan.removes.map((a) => a.name).join(', ')}</label>
          </div>
        </div>
      {/if}
    </div>
  {:else if step === 'installing'}
    <div class="stack">
      <p><strong>{STAGES[stage]}…</strong></p>
      <div class="bar"><span style="width: {Math.round(fraction * 100)}%"></span></div>
      <p class="muted small">Keep the cable in and this tab open.</p>
    </div>
  {:else if step === 'done'}
    <div class="center">
      <h3>Installed</h3>
      <p class="muted">{project.name} is on the calculator's home screen.</p>
    </div>
  {:else if step === 'error'}
    <div class="stack">
      <div class="warning"><p>{error}</p></div>

    </div>
  {/if}

  {#snippet footer()}
    {#if supported}
      {#if step === 'intro'}
        {#if dev}<Button variant="ghost" onclick={() => connect(true)}>Pretend (dev)</Button>{/if}
        <Button onclick={ondownload}>Download .nwa</Button>
        <Button variant="primary" onclick={() => connect()}>Connect</Button>
      {:else if step === 'ready'}
        <Button onclick={onclose}>Cancel</Button>
        <Button variant="primary" disabled={!agree} onclick={run}>Install</Button>
      {:else if step === 'error'}
        <Button onclick={ondownload}>Download .nwa</Button>
        <Button variant="primary" onclick={reset}>Try again</Button>
      {:else if step === 'done'}
        <Button variant="primary" onclick={onclose}>Done</Button>
      {/if}
    {/if}
  {/snippet}
</Modal>

<style>
  .stack {
    display: grid;
    gap: 14px;
  }
  /* Numbered steps in yellow circles. */
  .steps {
    list-style: none;
    counter-reset: step;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
    font-size: 15px;
  }
  .steps li {
    counter-increment: step;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .steps li::before {
    content: counter(step);
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 14px;
    font-weight: 800;
    display: grid;
    place-items: center;
  }
  .center {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: 10px;
    padding: 24px 8px;
  }
  .center h3 {
    font-size: 28px;
    font-weight: 300;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--card);
    border-top-color: var(--purple);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .calc-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--card);
  }
  .calc-card div {
    display: grid;
  }
  .calc-card strong {
    font-size: 15px;
  }
  h4 {
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
    margin-bottom: 6px;
  }
  .apps {
    list-style: none;
    margin: 0;
    padding: 4px;
    display: grid;
    border-radius: var(--radius);
    background: var(--layout);
  }
  .apps li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
  }
  .apps li + li {
    box-shadow: 0 -1px 0 var(--line);
  }
  .apps li.removed {
    opacity: 0.55;
  }
  .apps li.removed .name {
    text-decoration: line-through;
  }
  .apps img,
  .ph {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: var(--card);
  }
  .name {
    flex: 1;
    font-weight: 700;
    font-size: 13px;
  }
  .badge {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 10px;
    border-radius: var(--pill);
    background: var(--accent);
    color: #fff;
  }
  .badge.warn {
    background: var(--danger);
  }
  /* NumWorks' alert box. */
  .warning {
    display: flex;
    gap: 10px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: #f2dede;
    color: #a94442;
  }
  .agree {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
    font-weight: 700;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--card);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--accent);
    transition: width 0.2s;
  }
</style>
