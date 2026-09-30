<script lang="ts">
  import { Trash2 } from '@lucide/svelte';
  import Button from '../ui/Button.svelte';
  import AppIcon from './AppIcon.svelte';
  import { TEMPLATES, type Template } from '../state/templates.ts';
  import { store } from '../state/project.svelte.ts';
  import { importProjectFile } from '../state/projectFile.ts';

  async function start(t: Template) {
    await store.open(t.create());
    await store.refreshList();
  }

  function openFile() {
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

  const supported = typeof navigator !== 'undefined' && 'usb' in navigator;
  const icons = TEMPLATES.map((t) => t.create().icon);
  const when = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
</script>

<div class="page">
  <header class="nav">
    <span class="brand">
      <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" width="26" height="26" />
      <span>NumNotes</span>
    </span>
    <span class="spacer"></span>
    <button class="nav-link" onclick={openFile}>Open a .numnotes file</button>
    <a class="nav-link" href="https://github.com/Mason363/NumNotes" target="_blank" rel="noreferrer">GitHub</a>
  </header>

  <section class="hero">
    <h1>Make an app for your NumWorks</h1>
    <p class="lead">Notes, pictures, PDFs and schedules, on your calculator.</p>
  </section>

  <main>
    <section class="card">
      <h2>Start from</h2>
      <div class="tiles">
        {#each TEMPLATES as t, i (t.id)}
          <button class="tile" onclick={() => start(t)}>
            <AppIcon icon={icons[i]} size={40} />
            <span class="tile-name">{t.title}</span>
            <span class="tile-desc">{t.description}</span>
          </button>
        {/each}
      </div>
    </section>

    {#if store.projects.length}
      <section class="card">
        <h2>Your apps</h2>
        <ul class="rows">
          {#each store.projects as p (p.id)}
            <li>
              <button class="row" onclick={() => store.openById(p.id)}>
                <span class="name">{p.name}</span>
                <span class="when">Edited {when(p.updatedAt)}</span>
              </button>
              <Button size="sm" onclick={() => store.openById(p.id)}>Open</Button>
              <button
                class="del"
                title="Delete"
                aria-label="Delete {p.name}"
                onclick={() => {
                  if (confirm(`Delete “${p.name}” from this browser?`)) store.remove(p.id);
                }}><Trash2 size={14} /></button
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <footer>
      <p class="muted small">
        For the NumWorks N0110, N0115 and N0120. Your files stay in this browser.
        NumNotes is an independent project, not made by NumWorks.
        {#if !supported}To send apps straight to the calculator, use Chrome or Edge. Other browsers can download the app file.{/if}
      </p>
    </footer>
  </main>
</div>

<style>
  .page {
    min-height: 100%;
    background: var(--bg);
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 20px;
    height: 46px;
    padding: 0 16px;
    background: var(--panel);
    border-bottom: 1px solid var(--line-strong);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 17px;
    color: var(--text);
  }
  .spacer {
    flex: 1;
  }
  .nav-link {
    border: none;
    background: transparent;
    padding: 0;
    font-size: 14px;
    color: var(--dim);
  }
  .nav-link:hover {
    color: var(--text);
    text-decoration: none;
  }
  .hero {
    text-align: center;
    padding: 48px 20px 28px;
  }
  h1 {
    font-size: 30px;
    font-weight: 400;
    color: var(--text);
  }
  .lead {
    margin-top: 8px;
    font-size: 16px;
    color: var(--dim);
  }
  main {
    max-width: 860px;
    margin: 0 auto;
    padding: 0 20px 48px;
    display: grid;
    gap: 28px;
  }
  .card {
    display: grid;
    gap: 10px;
  }
  .card > h2 {
    font-size: 13px;
    font-weight: 600;
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .tile {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 12px;
    align-items: center;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    background: var(--panel);
    padding: 12px 14px;
    text-align: left;
  }
  .tile:hover {
    border-color: rgba(0, 0, 0, 0.35);
    box-shadow: var(--shadow);
  }
  .tile :global(canvas) {
    grid-row: 1 / 3;
  }
  .tile-name {
    font-size: 15px;
    color: var(--text);
    align-self: end;
  }
  .tile-desc {
    font-size: 12px;
    color: var(--dim);
    align-self: start;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--panel);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 10px;
  }
  .rows li + li {
    border-top: 1px solid var(--line);
  }
  .rows li:hover {
    background: var(--hover);
  }
  .row {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 12px;
    border: none;
    background: transparent;
    padding: 12px 14px;
    text-align: left;
    min-width: 0;
  }
  .name {
    font-size: 15px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .when {
    font-size: 12px;
    color: var(--dim);
    white-space: nowrap;
  }
  .del {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--faint);
    display: grid;
    place-items: center;
  }
  .del:hover {
    color: var(--danger);
    background: var(--btn);
  }
  footer {
    display: grid;
    gap: 6px;
    justify-items: center;
    text-align: center;
  }
  @media (max-width: 720px) {
    .tiles {
      grid-template-columns: 1fr 1fr;
    }
  }
  @media (max-width: 480px) {
    .tiles {
      grid-template-columns: 1fr;
    }
    h1 {
      font-size: 24px;
    }
    .when {
      display: none;
    }
  }
</style>
