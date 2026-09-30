<script lang="ts">
  import { ChevronDown, Menu as MenuIcon } from '@lucide/svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Menu from '../ui/Menu.svelte';
  import HelpDialog from './HelpDialog.svelte';
  import IconDialog from './IconDialog.svelte';
  import InstallDialog from './InstallDialog.svelte';
  import StorageMeter from './StorageMeter.svelte';
  import AppIcon from './AppIcon.svelte';
  import { build } from '../state/build.svelte.ts';
  import { store } from '../state/project.svelte.ts';
  import { exportProject, importProjectFile } from '../state/projectFile.ts';
  import { newId } from '../state/assets.ts';

  let projectMenu = $state(false);
  let downloadMenu = $state(false);
  let iconOpen = $state(false);
  let installOpen = $state(false);
  let helpOpen = $state(false);
  let busy = $state(false);

  const project = $derived(store.project!);

  function save(data: Uint8Array | Blob, name: string) {
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const fileName = $derived((project.name.trim() || 'NumNotes').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'NumNotes');

  async function downloadNwa() {
    downloadMenu = false;
    busy = true;
    try {
      save(await build.nwa(), `${fileName}.nwa`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      busy = false;
    }
  }

  async function downloadProject() {
    downloadMenu = false;
    save(await exportProject(store.project!), `${fileName}.numnotes`);
  }

  async function openFile() {
    projectMenu = false;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.numnotes,application/zip';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await store.open(await importProjectFile(file));
        await store.refreshList();
      } catch (e) {
        alert(`Couldn't open that file: ${(e as Error).message}`);
      }
    };
    input.click();
  }

  async function duplicate() {
    projectMenu = false;
    const copy = structuredClone($state.snapshot(project));
    copy.id = newId('p');
    copy.name = `${copy.name} copy`;
    copy.projectId = crypto.getRandomValues(new Uint32Array(1))[0];
    await store.save();
    await store.open(copy);
    await store.refreshList();
  }

  async function removeProject() {
    projectMenu = false;
    if (!confirm(`Delete “${project.name}” from this browser? Apps already on a calculator are not affected.`)) return;
    const id = project.id;
    await store.remove(id);
    store.project = null;
  }

  async function switchTo(id: string) {
    projectMenu = false;
    await store.save();
    await store.openById(id);
  }
</script>

<header class="topbar">
  <Menu open={projectMenu} onclose={() => (projectMenu = false)}>
    {#snippet trigger()}
      <IconButton label="My apps" onclick={() => (projectMenu = !projectMenu)} aria-haspopup="menu"><MenuIcon /></IconButton>
    {/snippet}
    <button class="item" onclick={() => { projectMenu = false; store.project = null; }}>New app</button>
    <button class="item" onclick={openFile}>Open a .numnotes file</button>
    <button class="item" onclick={duplicate}>Duplicate this app</button>
    <button class="item" onclick={removeProject}>Delete this app</button>
    {#if store.projects.length > 1}
      <div class="sep"></div>
      <div class="menu-label">My apps</div>
      {#each store.projects.filter((p) => p.id !== project.id).slice(0, 8) as p (p.id)}
        <button class="item" onclick={() => switchTo(p.id)}>{p.name}</button>
      {/each}
    {/if}
  </Menu>

  <div class="identity">
    <button class="icon-btn" title="Change the app icon" onclick={() => (iconOpen = true)}>
      <AppIcon icon={project.icon} size={26} />
    </button>
    <input
      class="name"
      value={project.name}
      maxlength="24"
      aria-label="App name"
      placeholder="App name"
      oninput={(e) => {
        const v = (e.currentTarget as HTMLInputElement).value;
        store.edit((p) => (p.name = v), 'name');
      }}
    />
  </div>

  <a class="brand" href={import.meta.env.BASE_URL} onclick={(e) => { e.preventDefault(); store.project = null; }} title="All apps">
    <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" />
    <span>NumNotes</span>
  </a>

  <div class="right">
    <div class="meter-slot"><StorageMeter /></div>
    <button class="help" title="Keys on the calculator" aria-label="Help" onclick={() => (helpOpen = true)}>?</button>
    <div class="dl"><Menu open={downloadMenu} align="right" onclose={() => (downloadMenu = false)}>
      {#snippet trigger()}
        <Button size="sm" onclick={() => (downloadMenu = !downloadMenu)} disabled={busy} aria-haspopup="menu">Download <ChevronDown /></Button>
      {/snippet}
      <button class="item" onclick={downloadNwa}>
        <span>App file (.nwa)<span class="desc">For my.numworks.com/apps</span></span>
      </button>
      <button class="item" onclick={downloadProject}>
        <span>Project file (.numnotes)<span class="desc">Backup, or keep editing elsewhere</span></span>
      </button>
    </Menu></div>
    <Button size="sm" variant="primary" onclick={() => (installOpen = true)}>Send<span class="long">&nbsp;to calculator</span></Button>
  </div>
</header>

<HelpDialog open={helpOpen} onclose={() => (helpOpen = false)} />
<InstallDialog open={installOpen} onclose={() => (installOpen = false)} ondownload={downloadNwa} />

<style>
  .topbar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 46px;
    padding: 0 10px 0 6px;
    background: var(--panel);
    border-bottom: 1px solid var(--line-strong);
    min-width: 0;
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .icon-btn {
    border: none;
    padding: 3px;
    background: transparent;
    display: grid;
    border-radius: var(--radius-sm);
  }
  .icon-btn:hover {
    background: var(--hover);
  }
  .name {
    border: 1px solid transparent;
    background: transparent;
    padding: 4px 6px;
    font-size: 15px;
    width: 220px;
    min-width: 80px;
    border-radius: var(--radius-sm);
    color: var(--text);
  }
  .name:hover {
    border-color: var(--line);
  }
  .name:focus {
    border-color: var(--blue);
    outline: none;
  }
  /* Centered like the desmos wordmark. */
  .brand {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--dim);
    font-size: 17px;
    letter-spacing: 0.01em;
    text-decoration: none;
  }
  .brand:hover {
    color: var(--text);
    text-decoration: none;
  }
  .brand img {
    width: 22px;
    height: 22px;
  }
  .right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .help {
    width: 28px;
    height: 28px;
    flex: none;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 50%;
    background: var(--btn);
    color: var(--text);
    font-size: 14px;
    font-weight: 600;
    display: grid;
    place-items: center;
  }
  .help:hover {
    background: var(--btn-hover);
  }
  .topbar :global(.btn svg) {
    width: 14px;
    height: 14px;
  }
  @media (max-width: 1100px) {
    .brand {
      display: none;
    }
  }
  @media (max-width: 640px) {
    .topbar {
      gap: 4px;
      padding: 0 8px 0 4px;
    }
    .help,
    .dl,
    .meter-slot,
    .long {
      display: none;
    }
    .name {
      width: auto;
      flex: 1;
    }
    .identity {
      flex: 1;
    }
  }
</style>
