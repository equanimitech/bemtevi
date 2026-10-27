// bemtevi player: switch guide and backing at the same position, loop a section,
// slow down without changing pitch, follow the lyrics. No network, no library:
// one native <audio> per version. Inlined into every song page by `cli.mjs song-add`.
//
// <bemtevi-player data-unplayable="…">
//   <figure data-sync="<track ids>"><figcaption>Guia · Bb</figcaption><audio controls src="guia.m4a"></audio></figure>
//   <p class="transport" hidden> clock, speed, A, B, clear </p>
//   <p class="sections" hidden> <button data-start="42" data-end="65">Refrão</button> </p>
//   <p class="lyric-bar" hidden> select.track, input.follow, button.nudge, output.offset </p>
// </bemtevi-player>
// <section class="lyrics"> one <div class="lrc" data-track="<id>"> (or <pre>) per LRCLIB track </section>
// Without JS every version still plays with the browser's own controls, and the
// CLI's lyric track reads as it is. A version follows a track's timing only
// when its figure lists that track in data-sync. Two viewer choices persist in
// localStorage (the lyric track, per song, and following on or off); storage
// that throws just means nothing is remembered.

/** 62.54 → "1:02.5" @param {number} t */
const bemteviClock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

const bemteviStore = {
  /** @param {string} key */
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  /** @param {string} key @param {string} value */
  set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* not remembered */ } },
};

class BemteviPlayer extends HTMLElement {
  connectedCallback() {
    const figures = [...this.querySelectorAll('figure')];
    const audios = figures.map((f) => /** @type {HTMLAudioElement} */ (f.querySelector('audio')));
    if (audios.length === 0) return;
    /** @param {string} sel */
    const $ = (sel) => /** @type {HTMLElement} */ (this.querySelector(sel));
    const clock = /** @type {HTMLOutputElement} */ ($('output.clock'));
    const rateInput = /** @type {HTMLInputElement} */ ($('input.rate'));
    const rateOut = /** @type {HTMLOutputElement} */ ($('output.rate'));
    const range = /** @type {HTMLOutputElement} */ ($('output.range'));
    const page = this.closest('main') ?? document;
    const tracks = /** @type {HTMLElement[]} */ ([...page.querySelectorAll('.lyrics [data-track]')]);
    const picker = /** @type {HTMLSelectElement | null} */ (this.querySelector('select.track'));
    const followBox = /** @type {HTMLInputElement | null} */ (this.querySelector('input.follow'));
    const offsetBox = /** @type {HTMLElement | null} */ (this.querySelector('span.offset'));
    const offsetOut = /** @type {HTMLOutputElement | null} */ (this.querySelector('output.offset'));
    const lang = document.documentElement.lang || undefined;

    let active = 0;
    /** @type {number | null} */ let a = null;
    /** @type {number | null} */ let b = null;
    let frame = 0;
    let offset = 0;
    /** @type {HTMLElement | null} */ let lit = null;
    /** @type {HTMLElement | undefined} */ let track = tracks.find((t) => !t.hidden);
    const current = () => audios[active];
    const following = () => followBox?.checked ?? false;
    /** The shown track's lines, when following and this version keeps its time. */
    const lines = () => {
      const id = track?.dataset.track ?? '';
      const synced = (figures[active].dataset.sync ?? '').split(' ').includes(id);
      return following() && synced ? /** @type {HTMLElement[]} */ ([...(track?.querySelectorAll('[data-t]') ?? [])]) : [];
    };

    // Version toggle, built from the captions: the one move practice is made of.
    const toggle = document.createElement('p');
    toggle.className = 'versions';
    toggle.setAttribute('role', 'group');
    const buttons = figures.map((f, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = f.querySelector('figcaption')?.textContent ?? String(i + 1);
      button.addEventListener('click', () => select(i));
      toggle.append(button);
      return button;
    });
    if (figures.length > 1) {
      this.prepend(toggle);
      for (const caption of this.querySelectorAll('figcaption')) caption.hidden = true;
    }
    for (const hidden of this.querySelectorAll('p[hidden]')) hidden.removeAttribute('hidden');

    /** @param {number} i */
    const select = (i) => {
      const from = current();
      const to = audios[i];
      const playing = !from.paused;
      if (i !== active) {
        from.pause();
        to.currentTime = from.currentTime;
      }
      active = i;
      for (const [j, f] of figures.entries()) f.hidden = j !== i;
      for (const [j, btn] of buttons.entries()) btn.setAttribute('aria-pressed', String(j === i));
      if (playing) to.play();
      render();
    };

    const setRate = () => {
      const rate = Number(rateInput.value);
      for (const el of audios) {
        el.preservesPitch = true; // slower, same key
        el.defaultPlaybackRate = rate;
        el.playbackRate = rate;
      }
      rateOut.value = `${rate.toFixed(2)}×`;
    };

    const showRange = () => {
      range.value = a === null ? '' : `${bemteviClock(a)} → ${b === null ? '…' : bemteviClock(b)}`;
    };

    const render = () => {
      const t = current().currentTime;
      clock.value = bemteviClock(t);
      const line = lines().findLast((l) => Number(l.dataset.t) <= t - offset) ?? null;
      if (line === lit) return;
      lit?.classList.remove('now');
      line?.classList.add('now');
      lit = line;
      // Scroll only when the line has left the space below the sticky player.
      const box = line?.getBoundingClientRect();
      if (box && (box.top < this.getBoundingClientRect().bottom || box.bottom > innerHeight)) line?.scrollIntoView({ block: 'center' });
    };

    const tick = () => {
      const el = current();
      if (a !== null && b !== null && el.currentTime >= b) el.currentTime = a;
      render();
      frame = el.paused ? 0 : requestAnimationFrame(tick);
    };

    for (const [i, el] of audios.entries()) {
      el.addEventListener('play', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(tick);
      });
      el.addEventListener('seeked', render);
      el.addEventListener('loadedmetadata', setRate);
      // Files play as they arrive; when one doesn't, say which, in one line.
      const fail = () => {
        const note = document.createElement('p');
        note.className = 'note';
        note.textContent = `${this.dataset.unplayable ?? '✗'} ${decodeURI(el.getAttribute('src') ?? '')}`;
        figures[i].append(note);
      };
      el.addEventListener('error', fail);
      if (el.error) fail();
    }

    rateInput.addEventListener('input', setRate);
    $('.mark-a').addEventListener('click', () => {
      a = current().currentTime;
      if (b !== null && b <= a) b = null;
      showRange();
    });
    $('.mark-b').addEventListener('click', () => {
      const t = current().currentTime;
      a ??= 0;
      b = t > a ? t : null;
      showRange();
    });
    $('.clear').addEventListener('click', () => {
      a = b = null;
      showRange();
    });
    for (const button of this.querySelectorAll('.sections button')) {
      button.addEventListener('click', () => {
        const el = /** @type {HTMLElement} */ (button);
        a = Number(el.dataset.start);
        b = Number(el.dataset.end);
        showRange();
        current().currentTime = a;
        current().play();
      });
    }

    // Lyrics: which track to read, whether to follow it, and how late it runs.
    const pickKey = picker ? `bemtevi-lyrics:${picker.dataset.song}:${picker.dataset.default}` : '';
    /** @param {string} id */
    const showTrack = (id) => {
      const next = tracks.find((t) => t.dataset.track === id);
      if (!next) return;
      for (const t of tracks) t.hidden = t !== next;
      track = next;
      lit?.classList.remove('now');
      lit = null;
      render();
    };
    if (picker) {
      const saved = bemteviStore.get(pickKey);
      if (saved && [...picker.options].some((o) => o.value === saved)) {
        picker.value = saved;
        showTrack(saved);
      }
      picker.addEventListener('change', () => {
        bemteviStore.set(pickKey, picker.value);
        showTrack(picker.value);
      });
    }
    const setFollow = () => {
      if (offsetBox) offsetBox.hidden = !following();
      page.querySelector('.lyrics')?.classList.toggle('following', following());
      lit?.classList.remove('now');
      lit = null;
      render();
    };
    if (followBox) {
      followBox.checked = bemteviStore.get('bemtevi-follow-lyrics') !== 'off';
      followBox.addEventListener('change', () => {
        bemteviStore.set('bemtevi-follow-lyrics', followBox.checked ? 'on' : 'off');
        setFollow();
      });
    }
    for (const nudge of this.querySelectorAll('button.nudge')) {
      nudge.addEventListener('click', () => {
        offset = Math.round((offset + Number(/** @type {HTMLElement} */ (nudge).dataset.step)) * 10) / 10;
        if (offsetOut) offsetOut.value = `${offset > 0 ? '+' : ''}${offset.toLocaleString(lang)} s`;
        render();
      });
    }
    // A followed line is a seek target: click it to sing from there.
    for (const line of page.querySelectorAll('.lrc [data-t]')) {
      line.addEventListener('click', () => {
        if (!lines().includes(/** @type {HTMLElement} */ (line))) return;
        current().currentTime = Math.max(0, Number(/** @type {HTMLElement} */ (line).dataset.t) + offset);
      });
    }

    setRate();
    setFollow();
    select(0);
  }
}

customElements.define('bemtevi-player', BemteviPlayer);
