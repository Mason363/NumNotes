<script lang="ts" module>
  /** One key of the NumWorks keyboard: its Ion key index and labels. */
  export interface KeyDef {
    k: number;
    label: string;
    shift?: string;
    alpha?: string;
    wide?: boolean;
  }

  // Ion::Keyboard::Key indices, laid out like the real calculator.
  const ROW6: KeyDef[][] = [
    [
      { k: 12, label: 'shift' },
      { k: 13, label: 'alpha' },
      { k: 14, label: 'x,n,t', shift: 'cut', alpha: ':' },
      { k: 15, label: 'var', shift: 'copy', alpha: ';' },
      { k: 16, label: '⊞', shift: 'paste', alpha: '"' },
      { k: 17, label: '⌫', shift: 'clear', alpha: '%' },
    ],
    [
      { k: 18, label: 'eˣ', shift: '[', alpha: 'a' },
      { k: 19, label: 'ln', shift: ']', alpha: 'b' },
      { k: 20, label: 'log', shift: '{', alpha: 'c' },
      { k: 21, label: 'i', shift: '}', alpha: 'd' },
      { k: 22, label: ',', shift: '_', alpha: 'e' },
      { k: 23, label: 'xʸ', shift: '→', alpha: 'f' },
    ],
    [
      { k: 24, label: 'sin', shift: 'asin', alpha: 'g' },
      { k: 25, label: 'cos', shift: 'acos', alpha: 'h' },
      { k: 26, label: 'tan', shift: 'atan', alpha: 'i' },
      { k: 27, label: 'π', shift: '=', alpha: 'j' },
      { k: 28, label: '√', shift: '<', alpha: 'k' },
      { k: 29, label: 'x²', shift: '>', alpha: 'l' },
    ],
  ];
  const ROW5: KeyDef[][] = [
    [
      { k: 30, label: '7', alpha: 'm' },
      { k: 31, label: '8', alpha: 'n' },
      { k: 32, label: '9', alpha: 'o' },
      { k: 33, label: '(', alpha: 'p' },
      { k: 34, label: ')', alpha: 'q' },
    ],
    [
      { k: 36, label: '4', alpha: 'r' },
      { k: 37, label: '5', alpha: 's' },
      { k: 38, label: '6', alpha: 't' },
      { k: 39, label: '×', alpha: 'u' },
      { k: 40, label: '÷', alpha: 'v' },
    ],
    [
      { k: 42, label: '1', alpha: 'w' },
      { k: 43, label: '2', alpha: 'x' },
      { k: 44, label: '3', alpha: 'y' },
      { k: 45, label: '+', alpha: 'z' },
      { k: 46, label: '−', alpha: 'space' },
    ],
    [
      { k: 48, label: '0', alpha: '?' },
      { k: 49, label: '.', alpha: '!' },
      { k: 50, label: '×10ˣ' },
      { k: 51, label: 'ans' },
      { k: 52, label: 'EXE' },
    ],
  ];
</script>

<script lang="ts">
  interface Props {
    /** Sends an Epsilon event code. */
    send: (ev: number) => void;
    full?: boolean;
  }
  let { send, full = true }: Props = $props();

  // Shift/alpha compose events like the firmware: four pages of 54 codes.
  let shift = $state(false);
  let alpha = $state(false);
  let lock = $state(false);

  function press(k: number) {
    if (k === 12) {
      shift = !shift;
      send(12);
      return;
    }
    if (k === 13) {
      if (shift) {
        lock = !lock;
        alpha = lock;
        shift = false;
        send(67);
      } else {
        alpha = lock ? false : !alpha;
        lock = false;
        send(13);
      }
      return;
    }
    const page = alpha ? (shift ? 162 : 108) : shift ? 54 : 0;
    send(k < 12 ? k : k + page);
    shift = false;
    if (!lock) alpha = false;
  }
</script>

<div class="keypad">
  <div class="top">
    <div class="dpad">
      <button class="arrow up" aria-label="Up" onclick={() => press(1)}>▲</button>
      <button class="arrow left" aria-label="Left" onclick={() => press(0)}>◀</button>
      <button class="arrow right" aria-label="Right" onclick={() => press(3)}>▶</button>
      <button class="arrow down" aria-label="Down" onclick={() => press(2)}>▼</button>
    </div>
    <div class="mid">
      <button class="key round" title="Home (leaves the app)" onclick={() => press(6)}>⌂</button>
      <button class="key round" title="On/off" onclick={() => press(8)}>⏻</button>
    </div>
    <div class="okback">
      <button class="key round ok" onclick={() => press(4)}>OK</button>
      <button class="key round" title="Back" onclick={() => press(5)}>↩</button>
    </div>
  </div>

  {#each full ? ROW6 : ROW6.slice(0, 1) as row, r (r)}
    <div class="row six">
      {#each row as key (key.k)}
        <div class="cell">
          <span class="above">
            <span class="s">{key.shift ?? ''}</span>
            <span class="a">{key.alpha ?? ''}</span>
          </span>
          <button
            class="key"
            class:mod={key.k === 12 || key.k === 13}
            class:on={(key.k === 12 && shift) || (key.k === 13 && alpha)}
            class:locked={key.k === 13 && lock}
            onclick={() => press(key.k)}>{key.label}</button
          >
        </div>
      {/each}
    </div>
  {/each}
  {#if full}
    {#each ROW5 as row, r (r)}
      <div class="row five">
        {#each row as key (key.k)}
          <div class="cell">
            <span class="above"><span class="s"></span><span class="a">{key.alpha ?? ''}</span></span>
            <button class="key big" class:exe={key.k === 52} onclick={() => press(key.k)}>{key.label}</button>
          </div>
        {/each}
      </div>
    {/each}
  {:else}
    <div class="row five">
      {#each [ROW5[2][3], ROW5[2][4], ROW5[3][3], ROW5[3][4]] as key (key.k)}
        <div class="cell">
          <button class="key big" class:exe={key.k === 52} onclick={() => press(key.k)}>{key.label}</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .keypad {
    display: grid;
    gap: 3px;
    user-select: none;
  }
  .top {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }
  .dpad {
    position: relative;
    width: 96px;
    height: 72px;
  }
  .arrow {
    position: absolute;
    width: 32px;
    height: 24px;
    border: 1px solid #b9b9b9;
    background: #fafafa;
    color: #444;
    font-size: 10px;
    padding: 0;
  }
  .arrow:active,
  .key:active {
    background: #dcdcdc;
  }
  .up {
    left: 32px;
    top: 0;
  }
  .down {
    left: 32px;
    bottom: 0;
  }
  .left {
    left: 0;
    top: 24px;
  }
  .right {
    right: 0;
    top: 24px;
  }
  .mid,
  .okback {
    display: grid;
    gap: 6px;
    justify-items: center;
  }
  .okback {
    justify-self: end;
  }
  .row {
    display: grid;
    gap: 4px;
  }
  .six {
    grid-template-columns: repeat(6, 1fr);
  }
  .five {
    grid-template-columns: repeat(5, 1fr);
  }
  .cell {
    display: grid;
    gap: 1px;
  }
  .above {
    display: flex;
    justify-content: space-between;
    height: 11px;
    font-size: 8.5px;
    line-height: 11px;
    padding: 0 1px;
    font-weight: 600;
  }
  .s {
    color: #d89414;
  }
  .a {
    color: #8a8a8a;
  }
  .key {
    height: 22px;
    border: 1px solid #b9b9b9;
    background: #fafafa;
    color: #2b2b2b;
    font-size: 11px;
    font-weight: 600;
    padding: 0;
    border-radius: 2px;
  }
  .key.big {
    height: 26px;
    font-size: 13px;
  }
  .key.round {
    width: 40px;
    height: 24px;
  }
  .key.ok {
    font-size: 11px;
  }
  .key.mod.on {
    background: #ffe2a3;
    border-color: #e6a52b;
  }
  .key.locked {
    background: #ffb734;
  }
  .key.exe {
    font-size: 11px;
  }
</style>
