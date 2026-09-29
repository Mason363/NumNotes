<script lang="ts">
  import Button from '../ui/Button.svelte';
  import Menu from '../ui/Menu.svelte';
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
      <button class="brand" onclick={() => (projectMenu = !projectMenu)} aria-haspopup="menu">
        <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" />
        <span class="word">NumNotes</span>
        <span class="caret">▾</span>
      </button>
    {/snippet}
    <button class="item" onclick={() => { projectMenu = false; store.project = null; }}>New app…</button>
    <button class="item" onclick={openFile}>Open .numnotes file…</button>
    <button class="item" onclick={duplicate}>Duplicate this app</button>
    <button class="item" onclick={removeProject}>Delete this app</button>
    {#if store.projects.length > 1}
      <div class="sep"></div>
      {#each store.projects.filter((p) => p.id !== project.id).slice(0, 8) as p (p.id)}
        <button class="item" onclick={() => switchTo(p.id)}>{p.name}</button>
      {/each}
    {/if}
  </Menu>

  <div class="identity">
    <button class="icon-btn" title="Change the app icon" onclick={() => (iconOpen = true)}>
      <AppIcon icon={project.icon} size={28} />
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

  <div class="spacer"></div>

  <div class="history">
    <button class="text-btn" title="Undo (⌘Z)" disabled={!store.canUndo} onclick={() => store.undo()}>Undo</button>
    <button class="text-btn" title="Redo (⇧⌘Z)" disabled={!store.canRedo} onclick={() => store.redo()}>Redo</button>
  </div>

  <StorageMeter />

  <Menu open={downloadMenu} align="right" onclose={() => (downloadMenu = false)}>
    {#snippet trigger()}
      <Button onclick={() => (downloadMenu = !downloadMenu)} disabled={busy} aria-haspopup="menu">Download ▾</Button>
    {/snippet}
    <button class="item" onclick={downloadNwa}>
      <span>App file (.nwa)<span class="desc">For my.numworks.com/apps</span></span>
    </button>
    <button class="item" onclick={downloadProject}>
      <span>Project file (.numnotes)<span class="desc">Backup, or keep editing elsewhere</span></span>
    </button>
  </Menu>

  <Button variant="primary" onclick={() => (installOpen = true)}>Send to calculator</Button>
</header>

<IconDialog open={iconOpen} onclose={() => (iconOpen = false)} />
<InstallDialog open={installOpen} onclose={() => (installOpen = false)} ondownload={downloadNwa} />

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    height: 46px;
    background: var(--panel);
    border-bottom: 1px solid var(--line-strong);
    min-width: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    border: none;
    background: transparent;
    padding: 4px 6px;
    height: 34px;
    border-radius: var(--radius-sm);
  }
  .brand:hover {
    background: var(--hover);
  }
  .brand img {
    width: 22px;
    height: 22px;
  }
  .word {
    font-weight: 700;
    font-size: 14px;
  }
  .caret {
    font-size: 10px;
    color: var(--dim);
  }
  .identity {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-left: 10px;
    border-left: 1px solid var(--line);
    min-width: 0;
  }
  .icon-btn {
    border: 1px solid transparent;
    padding: 1px;
    background: transparent;
    display: grid;
  }
  .icon-btn:hover {
    border-color: var(--line-strong);
  }
  .name {
    border: 1px solid transparent;
    background: transparent;
    padding: 4px 6px;
    font-size: 14px;
    font-weight: 650;
    width: 200px;
    min-width: 80px;
    border-radius: var(--radius-sm);
  }
  .name:hover {
    border-color: var(--line);
  }
  .name:focus {
    border-color: var(--text);
    outline: none;
  }
  .spacer {
    flex: 1;
  }
  .history {
    display: flex;
  }
  .text-btn {
    border: none;
    background: transparent;
    padding: 4px 8px;
    font-size: 12.5px;
    color: var(--text);
    border-radius: var(--radius-sm);
  }
  .text-btn:hover:not(:disabled) {
    background: var(--hover);
  }
  .text-btn:disabled {
    color: var(--faint);
    cursor: default;
  }
  @media (max-width: 1000px) {
    .word {
      display: none;
    }
  }
  @media (max-width: 640px) {
    .history {
      display: none;
    }
    .name {
      width: 110px;
    }
  }
</style>
