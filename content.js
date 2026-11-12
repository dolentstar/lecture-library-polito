// Lecture Library for PoliTo – speed and skip controls (content script)
// Adds a compact speed control under every <video> on *.polito.it, remembers the chosen
// speed and shows a brief on-video indicator when it changes.
// Keyboard (Italian and US layouts):  +  faster   -  slower   0  back to 1x   (step 0.10)
//                                     ←  back 10 s   →  forward 10 s
(() => {
  const MIN = 0.25, MAX = 4, STEP = 0.1, JUMP = 10;
  const PRESETS = [1, 1.25, 1.5, 1.75, 2];

  // After the extension is reloaded or updated, scripts already running in open tabs lose access to
  // chrome.* APIs ("Extension context invalidated"). Saving then fails silently instead of throwing.
  const save = (data) => {
    try { if (chrome.runtime?.id) chrome.storage.local.set(data).catch(() => {}); } catch (_) { /* context gone */ }
  };
  const clamp = (r) => Math.min(MAX, Math.max(MIN, Math.round(r * 100) / 100));
  const fmt = (r) => +r.toFixed(2) + "×";

  let speed = 1;
  const bars = new Map(); // video -> { host, value, presets }
  const ours = new WeakMap(); // video -> rate we set (to tell our changes from the site's)

  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap { display: flex; align-items: center; gap: 10px; margin: 10px 0 6px;
            font: 500 13px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
            color: #1d1d1f; -webkit-font-smoothing: antialiased; }
    .label { color: #86868b; font-weight: 500; letter-spacing: .01em; }
    .pill { display: inline-flex; align-items: center; height: 32px; padding: 2px;
            background: rgba(118,118,128,.12); border-radius: 999px; }
    .step { width: 32px; height: 28px; border: 0; border-radius: 999px; background: transparent;
            color: #1d1d1f; font: 400 18px/1 -apple-system, BlinkMacSystemFont, sans-serif;
            cursor: pointer; transition: background .15s ease; display: grid; place-items: center; }
    .step:hover { background: rgba(0,0,0,.06); }
    .step:active { background: rgba(0,0,0,.1); }
    .value { width: 68px; height: 28px; padding: 0 10px; border: 0; border-radius: 999px;
             background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 0 0 .5px rgba(0,0,0,.06);
             font: 600 13px/28px -apple-system, BlinkMacSystemFont, sans-serif; color: #1d1d1f;
             text-align: center; font-variant-numeric: tabular-nums; cursor: text; outline: none; }
    .value:focus { box-shadow: 0 0 0 3px rgba(0,113,227,.35); }
    .presets { display: inline-flex; height: 32px; padding: 2px; background: rgba(118,118,128,.12); border-radius: 9px; }
    .presets button { border: 0; background: transparent; color: #1d1d1f; border-radius: 7px; padding: 0 9px;
                      font: 500 12px/1 -apple-system, BlinkMacSystemFont, sans-serif; font-variant-numeric: tabular-nums;
                      cursor: pointer; transition: background .15s ease; }
    .presets button:hover { background: rgba(0,0,0,.05); }
    .presets button.on { background: #fff; font-weight: 600;
                         box-shadow: 0 3px 8px rgba(0,0,0,.12), 0 3px 1px rgba(0,0,0,.04); }
    .seek { width: 40px; color: #1d1d1f; }
    .seek svg { width: 25px; height: 25px; display: block; }
    .gap { width: 6px; }
  `;

  // Circular-arrow icons with "10", drawn in the style of the iOS skip buttons.
  const ICON_FWD = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16.95 7.05A7 7 0 1 1 12 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M9.6 2.6 12 5 9.6 7.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="12" y="14.6" text-anchor="middle" font-size="7.6" font-weight="600"
            font-family="-apple-system, BlinkMacSystemFont, sans-serif" fill="currentColor">10</text>
    </svg>`;
  const ICON_BACK = ICON_FWD
    .replace('<path d="M16.95', '<g transform="translate(24 0) scale(-1 1)"><path d="M16.95')
    .replace('stroke-linejoin="round"/>', 'stroke-linejoin="round"/></g>');

  function buildBar(video) {
    const host = document.createElement("div");
    host.className = "polito-speed-control";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap">
        <div class="pill">
          <button class="step seek" data-s="-1" title="Back ${JUMP} s  (←)">${ICON_BACK}</button>
          <button class="step seek" data-s="1" title="Forward ${JUMP} s  (→)">${ICON_FWD}</button>
        </div>
        <span class="gap"></span>
        <span class="label">Speed</span>
        <div class="pill">
          <button class="step" data-d="-1" title="Slower  (−)">−</button>
          <input class="value" type="text" inputmode="decimal" spellcheck="false"
                 title="Type any speed and press Return  ·  ↑ ↓ change by 0.10">
          <button class="step" data-d="1" title="Faster  (+)">+</button>
        </div>
        <div class="presets">
          ${PRESETS.map((p) => `<button data-p="${p}" title="${p === 1 ? "Normal speed  (0)" : p + "×"}">${p}×</button>`).join("")}
        </div>
      </div>`;
    const value = root.querySelector(".value");
    const presets = [...root.querySelectorAll(".presets button")];
    root.querySelectorAll(".step[data-d]").forEach((b) =>
      b.addEventListener("click", () => setSpeed(speed + STEP * +b.dataset.d, true)));
    root.querySelectorAll(".seek").forEach((b) =>
      b.addEventListener("click", () => seek(video, JUMP * +b.dataset.s)));
    presets.forEach((b) => b.addEventListener("click", () => setSpeed(+b.dataset.p, true)));
    value.addEventListener("focus", () => value.select());
    value.addEventListener("keydown", (e) => {
      // Keys typed in the field belong to the field: never seek the video or trigger shortcuts.
      e.stopPropagation();
      if (e.key === "Enter") {
        const r = parseFloat(value.value.replace(",", ".").replace("×", ""));
        if (r > 0) setSpeed(r, true);
        value.blur();
      } else if (e.key === "Escape") {
        value.blur();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSpeed(speed + (e.key === "ArrowUp" ? STEP : -STEP), true);
        value.value = fmt(speed);
        value.select();
      }
    });
    value.addEventListener("blur", () => { value.value = fmt(speed); });
    video.insertAdjacentElement("afterend", host);
    return { host, value, presets };
  }

  // Brief centred indicator over the video, in the style of the macOS volume HUD.
  let hud, hudTimer;
  function showHud(video, text = fmt(speed)) {
    if (!hud) {
      const host = document.createElement("div");
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>
        .hud { position: fixed; z-index: 2147483647; transform: translate(-50%,-50%);
               padding: 14px 22px; border-radius: 18px; pointer-events: none;
               background: rgba(30,30,32,.55); backdrop-filter: blur(20px) saturate(180%);
               -webkit-backdrop-filter: blur(20px) saturate(180%);
               color: #fff; font: 600 28px/1 -apple-system, BlinkMacSystemFont, sans-serif;
               font-variant-numeric: tabular-nums; letter-spacing: -.01em;
               opacity: 0; transition: opacity .25s ease; }
        .hud.on { opacity: 1; transition: opacity .1s ease; }
      </style><div class="hud"></div>`;
      document.documentElement.appendChild(host);
      hud = root.querySelector(".hud");
    }
    const r = video.getBoundingClientRect();
    if (r.width < 50 || r.bottom < 0 || r.top > innerHeight) return;
    hud.style.left = r.left + r.width / 2 + "px";
    hud.style.top = r.top + r.height / 2 + "px";
    hud.textContent = text;
    hud.classList.add("on");
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove("on"), 700);
  }

  function apply(video) {
    // defaultPlaybackRate survives a source change, so a new lecture does not fall back to 1x.
    video.defaultPlaybackRate = speed;
    if (Math.abs(video.playbackRate - speed) > 0.001) {
      ours.set(video, speed);
      video.playbackRate = speed;
    }
    const bar = bars.get(video);
    if (bar) {
      if (bar.host.shadowRoot.activeElement !== bar.value) bar.value.value = fmt(speed);
      bar.presets.forEach((b) => b.classList.toggle("on", Math.abs(+b.dataset.p - speed) < 0.001));
    }
  }

  function setSpeed(r, interactive = false, persist = true) {
    speed = clamp(r);
    bars.forEach((_, v) => apply(v));
    if (interactive) bars.forEach((_, v) => showHud(v));
    if (persist) save({ speed });
  }

  function seek(video, delta) {
    const end = isFinite(video.duration) ? video.duration : Infinity;
    video.currentTime = Math.min(end, Math.max(0, video.currentTime + delta));
    showHud(video, (delta < 0 ? "−" : "+") + Math.abs(delta) + " s");
  }

  // The lecture video the shortcuts act on: the one being played, else the first one on the page.
  function mainVideo() {
    const vids = [...bars.keys()];
    return vids.find((v) => !v.paused) || vids[0];
  }

  function attach(video) {
    if (bars.has(video)) return;
    bars.set(video, buildBar(video));
    ["loadedmetadata", "play"].forEach((ev) => video.addEventListener(ev, () => apply(video)));
    // If the site's own 1x/1.5x/2x/3x buttons change the rate, adopt that value.
    video.addEventListener("ratechange", () => {
      const r = video.playbackRate;
      if (Math.abs((ours.get(video) ?? -1) - r) > 0.001 && Math.abs(r - speed) > 0.001) setSpeed(r);
    });
    apply(video);
  }

  // Hide the site's own speed buttons (1x, 1.5x, 2x, 3x): this control replaces them.
  // Only buttons inside the lecture player container whose whole label is a speed are touched.
  const SITE_SPEED = /^\s*[›>»]?\s*\d+(\.\d+)?\s*x\s*$/i;
  function hideSiteSpeedButtons() {
    document.querySelectorAll('[class*="defContainer_"] button, [class*="defContainer_"] a').forEach((b) => {
      if (b.dataset.pscHidden || !SITE_SPEED.test(b.textContent)) return;
      b.dataset.pscHidden = "1";
      b.style.setProperty("display", "none", "important");
      const p = b.parentElement;
      if (p && [...p.children].every((c) => c.dataset.pscHidden)) {
        p.style.setProperty("display", "none", "important");
      }
    });
  }

  // Act only on a course's Virtual classroom page: the recordings list must be present, and only the
  // lecture player (id "videoPlayer_<course>") is controlled. Any other video is left alone.
  const isVirtualClassroom = () => !!document.querySelector('ul[id^="navbar_left_menu_"]');

  function scan() {
    if (isVirtualClassroom()) document.querySelectorAll('video[id^="videoPlayer_"]').forEach(attach);
    bars.forEach((b, v) => { if (!v.isConnected) { b.host.remove(); bars.delete(v); } });
    if (bars.size) hideSiteSpeedButtons();
  }

  document.addEventListener("keydown", (e) => {
    if (!bars.size || e.ctrlKey || e.metaKey || e.altKey) return;
    // composedPath()[0] is the real target, also inside shadow DOM (e.target is retargeted to the host).
    const t = e.composedPath()[0] || e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === "+" || e.key === "=") setSpeed(speed + STEP, true);
    else if (e.key === "-" || e.key === "_") setSpeed(speed - STEP, true);
    else if (e.key === "0") setSpeed(1, true);
    else if (e.key === "ArrowLeft") seek(mainVideo(), -JUMP);
    else if (e.key === "ArrowRight") seek(mainVideo(), JUMP);
    else return;
    // Capture phase + stop: the page and the native player must not handle the same key again.
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Messages from library.js (e.g. "Resumed at 12:34") shown with the same on-video indicator.
  document.addEventListener("psc-hud", (e) => { const v = mainVideo(); if (v) showHud(v, e.detail); });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.speed && Math.abs(changes.speed.newValue - speed) > 0.001) {
      setSpeed(changes.speed.newValue, true, false);
    }
  });

  chrome.storage.local.get({ speed: 1 }, (data) => {
    speed = clamp(data.speed);
    scan();
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  });
})();
