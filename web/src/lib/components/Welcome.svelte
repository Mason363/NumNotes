<script lang="ts">
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
  const when = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
</script>

<div class="page">
  <div class="bar">NumNotes</div>
  <main>
    <header>
      <img src="{import.meta.env.BASE_URL}favicon.svg" alt="" width="40" height="40" />
      <div>
        <h1>NumNotes</h1>
        <p>Turn notes, pictures, PDFs and schedules into an app for your NumWorks calculator. Build it here, then send it over USB.</p>
      </div>
    </header>

    <section>
      <h2 class="label-caps">New app</h2>
      <ul class="rows">
        {#each TEMPLATES as t (t.id)}
          <li>
            <button onclick={() => start(t)}>
              <span class="name">{t.title}</span>
              <span class="desc">{t.description}</span>
              <span class="go">Create</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>

    {#if store.projects.length}
      <section>
        <h2 class="label-caps">Your apps</h2>
        <ul class="rows">
          {#each store.projects as p (p.id)}
            <li class="project">
              <button onclick={() => store.openById(p.id)}>
                <span class="name">{p.name}</span>
                <span class="desc">Edited {when(p.updatedAt)}</span>
                <span class="go">Open</span>
              </button>
              <button
                class="del"
                aria-label="Delete {p.name}"
                onclick={() => {
                  if (confirm(`Delete “${p.name}” from this browser?`)) store.remove(p.id);
                }}>Delete</button
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <footer>
      <button class="link" onclick={openFile}>Open a .numnotes file…</button>
      <p class="muted small">
        For the NumWorks N0110, N0115 and N0120. Your files never leave this browser.
        {#if !supported}To send apps straight to the calculator, use Chrome or Edge; other browsers can download the app file instead.{/if}
      </p>
    </footer>
  </main>
</div>

<style>
  .page {
    min-height: 100%;
    background: var(--bg);
  }
  .bar {
    height: 24px;
    background: var(--accent);
    color: var(--on-accent);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    display: grid;
    place-items: center;
  }
  main {
    max-width: 760px;
    margin: 0 auto;
    padding: 40px 20px;
    display: grid;
    gap: 28px;
  }
  header {
    display: flex;
    gap: 16px;
    align-items: flex-start;
  }
  h1 {
    font-size: 22px;
  }
  header p {
    color: var(--dim);
    font-size: 14px;
    max-width: 560px;
    margin-top: 2px;
  }
  section {
    display: grid;
    gap: 8px;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line-strong);
    background: var(--panel);
  }
  .rows li {
    display: flex;
    border-bottom: 1px solid var(--line);
  }
  .rows li:last-child {
    border-bottom: none;
  }
  .rows button:first-child {
    flex: 1;
    display: grid;
    grid-template-columns: 170px 1fr auto;
    align-items: center;
    gap: 12px;
    border: none;
    background: transparent;
    padding: 9px 12px;
    text-align: left;
  }
  .rows button:first-child:hover {
    background: var(--accent-soft);
  }
  .name {
    font-weight: 650;
  }
  .desc {
    color: var(--dim);
  }
  .go {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-text);
  }
  .del {
    border: none;
    border-left: 1px solid var(--line);
    background: transparent;
    color: var(--dim);
    padding: 0 12px;
    font-size: 12px;
  }
  .del:hover {
    color: var(--danger);
    background: var(--hover);
  }
  footer {
    display: grid;
    gap: 6px;
  }
  .link {
    justify-self: start;
    border: none;
    background: transparent;
    padding: 0;
    color: var(--accent-text);
    font-weight: 600;
    text-decoration: underline;
  }
  @media (max-width: 560px) {
    .rows button:first-child {
      grid-template-columns: 1fr auto;
    }
    .desc {
      display: none;
    }
  }
</style>
