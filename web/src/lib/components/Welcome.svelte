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
    <h1>Your notes, on your calculator</h1>
    <p class="lead">Turn notes, pictures, PDFs and schedules into an app for your NumWorks.</p>
  </section>

  <main>
    <section class="card">
      <h2 class="panel-title">Pick a template to start</h2>
      <div class="tiles">
        {#each TEMPLATES as t, i (t.id)}
          <button class="tile" onclick={() => start(t)}>
            <AppIcon icon={icons[i]} size={48} />
            <span class="tile-name">{t.title}</span>
            <span class="tile-desc">{t.description}</span>
          </button>
        {/each}
      </div>
    </section>

    {#if store.projects.length}
      <section class="card">
        <h2 class="panel-title">Your apps</h2>
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
        {#if !supported}To send apps straight to the calculator, use Chrome or Edge. Other browsers can download the app file.{/if}
      </p>
    </footer>
  </main>
</div>

<style>
  .page {
    min-height: 100%;
    background: var(--layout);
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 20px;
    height: 56px;
    padding: 0 24px;
    background: var(--panel);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 16px;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .spacer {
    flex: 1;
  }
  .nav-link {
    border: none;
    background: transparent;
    padding: 0;
    font-size: 14px;
    font-weight: 400;
    color: var(--text);
  }
  .nav-link:hover {
    color: var(--purple);
    text-decoration: none;
  }
  /* Thin headline and lead, like numworks.com. */
  .hero {
    text-align: center;
    padding: 56px 20px 36px;
    background: linear-gradient(0deg, var(--layout), var(--panel));
  }
  h1 {
    font-size: 38px;
    font-weight: 300;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  .lead {
    margin-top: 10px;
    font-size: 18px;
    font-weight: 300;
    color: var(--label);
  }
  main {
    max-width: 820px;
    margin: 0 auto;
    padding: 0 20px 48px;
    display: grid;
    gap: 16px;
  }
  /* The Board's "Select an app" card. */
  .card {
    background: var(--card);
    border-radius: var(--radius);
    padding: 14px 8px 8px;
    display: grid;
    gap: 12px;
  }
  .card > h2 {
    text-align: center;
  }
  .tiles {
    background: var(--panel);
    border-radius: var(--radius);
    padding: 12px;
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 4px;
  }
  .tile {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 4px;
    border: 2px solid transparent;
    border-radius: var(--radius);
    background: var(--panel);
    padding: 12px 6px 10px;
    text-align: center;
  }
  .tile:hover {
    background: var(--layout);
  }
  .tile:hover .tile-name {
    color: var(--text);
  }
  .tile :global(canvas) {
    margin-bottom: 4px;
  }
  .tile-name {
    font-size: 12px;
    font-weight: 700;
    color: var(--label);
  }
  .tile-desc {
    font-size: 11px;
    color: var(--dim);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 6px;
    background: var(--panel);
    border-radius: var(--radius);
    display: grid;
  }
  .rows li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 6px;
    border-radius: var(--radius-sm);
  }
  .rows li + li {
    box-shadow: 0 -1px 0 var(--line);
  }
  .rows li:hover {
    background: var(--layout);
  }
  .row {
    flex: 1;
    display: flex;
    align-items: baseline;
    gap: 12px;
    border: none;
    background: transparent;
    padding: 10px 10px;
    text-align: left;
    min-width: 0;
  }
  .name {
    font-weight: 700;
    color: var(--purple);
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
    border-radius: 50%;
    background: transparent;
    color: var(--faint);
    display: grid;
    place-items: center;
  }
  .del:hover {
    color: var(--danger);
    background: var(--panel);
  }
  footer {
    display: grid;
    gap: 6px;
    justify-items: center;
    text-align: center;
    padding-top: 8px;
  }
  @media (max-width: 720px) {
    .tiles {
      grid-template-columns: repeat(3, 1fr);
    }
  }
  @media (max-width: 560px) {
    h1 {
      font-size: 28px;
    }
    .lead {
      font-size: 16px;
    }
    .when {
      display: none;
    }
    .nav {
      padding: 0 16px;
    }
  }
</style>
