// Lecture Library for PoliTo – lecture library (content script)
// Replaces the plain list of recordings on a course's "Virtual classroom" page with an
// ordered library: numbered lectures grouped by month, search, an "Unwatched" filter,
// per-lecture progress, watched marks and automatic resume from the last position.
// Lectures are still opened through the site's own (hidden) links, so loading is unchanged.
(() => {
  // After the extension is reloaded or updated, scripts already running in open tabs lose access to
  // chrome.* APIs ("Extension context invalidated"). Saving then fails silently instead of throwing.
  const save = (data) => {
    try { if (chrome.runtime?.id) chrome.storage.local.set(data).catch(() => {}); } catch (_) { /* context gone */ }
  };
  const ul0 = () => document.querySelector('ul[id^="navbar_left_menu_"]');
  let tries = 0;
  const wait = setInterval(() => {
    if (ul0() || ++tries > 40) { clearInterval(wait); if (ul0()) init(ul0()); }
  }, 500);

  function init(ul) {
    const courseId = ul.id.replace("navbar_left_menu_", "");
    const video = () => document.getElementById("videoPlayer_" + courseId) || document.querySelector("video");
    const leftCol = ul.closest(".col-md-4");
    if (!leftCol || leftCol.querySelector(".psc-library")) return;

    // ---------- data ----------
    const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
    const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

    const lectures = [...ul.querySelectorAll(":scope > li > a.link_vc_date")].map((a, i) => {
      const li = a.parentElement;
      const raw = a.textContent.replace(/\s+/g, " ").trim();
      const dm = (li.querySelector(".small")?.textContent || raw).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      const date = dm ? new Date(+dm[3], +dm[2] - 1, +dm[1]) : null;
      let title = raw.replace(/^(lecture|lezione)\s+\d{1,2}\/\d{1,2}\/\d{4}\s*[=:–-]?\s*/i, "").trim();
      const short = raw.match(/^(L\d+)\s+del\s+/i);
      if (short) title = "Session " + short[1].toUpperCase();
      if (!title) title = raw;
      title = title.charAt(0).toUpperCase() + title.slice(1);
      return {
        a, i, title, date,
        isNew: /ultime\s+48\s+ore|last\s+48\s+hours/i.test(li.textContent),
        // data-vc identifies the recording (data-id_inc is the same for every lecture).
        key: courseId + ":" + (a.getAttribute("data-vc") || a.getAttribute("data-bbb-id") || (dm ? dm[0] : "") + ":" + i),
      };
    });
    if (!lectures.length) return;

    let progress = {};
    let current = lectures.find((l) => /bold/.test(l.a.getAttribute("style") || "")) || lectures[0];
    let filter = "all", query = "", resumeKey = current.key;

    // ---------- UI ----------
    const host = document.createElement("div");
    host.className = "psc-library";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <section class="lib">
        <header>
          <div>
            <div class="h">Lectures</div>
            <div class="sub" id="sub"></div>
          </div>
          <button class="focus" id="focus" title="Focus mode: only lectures and player  (F)">
            <svg viewBox="0 0 24 24" class="enter"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
            <svg viewBox="0 0 24 24" class="exit"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>
            <span class="enter">Focus</span><span class="exit">Exit</span>
          </button>
        </header>
        <div class="tools">
          <label class="search">
            <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/></svg>
            <input id="q" type="text" placeholder="Search" spellcheck="false">
          </label>
          <div class="seg"><button data-f="all" class="on">All</button><button data-f="todo">Unwatched</button></div>
        </div>
        <div class="list" id="list"></div>
      </section>`;
    leftCol.prepend(host);
    // Hide the original menu (its links stay in the page and are still used to load lectures).
    const oldWell = ul.closest(".well");
    if (oldWell) oldWell.style.setProperty("display", "none", "important");

    const $ = (s) => root.querySelector(s);
    const listEl = $("#list");

    // ---------- focus mode ----------
    // A full-window view with only the library (left) and the player (right). Site elements are
    // not moved or removed: a backdrop covers the page and the two parts are pinned above it.
    const pageStyle = document.createElement("style");
    pageStyle.textContent = FOCUS_PAGE_CSS;
    document.head.appendChild(pageStyle);
    const backdrop = document.createElement("div");
    backdrop.id = "psc-backdrop";
    const titleHost = document.createElement("div");
    titleHost.id = "psc-focus-title";
    const titleRoot = titleHost.attachShadow({ mode: "open" });
    titleRoot.innerHTML = `<style>
        :host { all: initial; }
        .t { font: 600 22px/1.25 -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif; letter-spacing: -.02em;
             color: #1d1d1f; -webkit-font-smoothing: antialiased; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .s { margin-top: 4px; font: 500 13px/1 -apple-system, BlinkMacSystemFont, sans-serif; color: #86868b; }
      </style><div class="t" id="t"></div><div class="s" id="s"></div>`;
    document.body.append(backdrop, titleHost);

    function setFocus(on, persist = true) {
      document.documentElement.classList.toggle("psc-focus", on);
      host.toggleAttribute("focus", on);
      if (persist) save({ focus: on });
      if (on) root.querySelector(".row.cur")?.scrollIntoView({ block: "nearest" });
    }
    $("#focus").addEventListener("click", () => setFocus(!document.documentElement.classList.contains("psc-focus")));
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // composedPath()[0] is the real target, also inside shadow DOM (e.target is retargeted to the host).
      const t = e.composedPath()[0] || e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const on = document.documentElement.classList.contains("psc-focus");
      if (e.key === "f" || e.key === "F") setFocus(!on);
      else if (e.key === "Escape" && on && !document.fullscreenElement) setFocus(false);
      else return;
      e.preventDefault();
    }, true);

    const fmtTime = (s) => {
      s = Math.floor(s);
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
    };
    const fmtDur = (s) => {
      const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      return h ? `${h} h ${m} min` : `${m} min`;
    };
    const ICON = {
      done: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" class="fill"/><path d="m8 12.3 2.7 2.7L16 9.7" class="tick"/></svg>`,
      ring: (p) => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" class="track"/>
        <circle cx="12" cy="12" r="8.5" class="arc" stroke-dasharray="${(p * 53.4).toFixed(1)} 53.4" transform="rotate(-90 12 12)"/></svg>`,
      empty: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" class="track"/></svg>`,
    };

    function render() {
      const watched = lectures.filter((l) => progress[l.key]?.w).length;
      $("#sub").textContent = `${watched} of ${lectures.length} watched`;
      titleRoot.getElementById("t").textContent = `${String(current.i + 1).padStart(2, "0")}  ${current.title}`;
      titleRoot.getElementById("s").textContent = current.date
        ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(current.date) : "";
      const q = query.toLowerCase();
      const shown = lectures.filter((l) =>
        (filter === "all" || !progress[l.key]?.w) &&
        (!q || l.title.toLowerCase().includes(q) || (l.date && dayFmt.format(l.date).toLowerCase().includes(q))));
      let html = "", month = "";
      for (const l of shown) {
        const m = l.date ? monthFmt.format(l.date) : "Other";
        if (m !== month) { html += `<div class="month">${m}</div>`; month = m; }
        const p = progress[l.key] || {};
        const frac = p.w ? 1 : p.d ? Math.min(1, p.t / p.d) : 0;
        const meta = [l.date ? dayFmt.format(l.date) : "", p.d ? fmtDur(p.d) : "",
          !p.w && frac > 0.01 ? `${Math.round(frac * 100)}%` : ""].filter(Boolean).join(" · ");
        html += `
          <div class="row${l === current ? " cur" : ""}${p.w ? " done" : ""}" data-i="${l.i}">
            <div class="num">${String(l.i + 1).padStart(2, "0")}</div>
            <div class="body">
              <div class="title">${esc(l.title)}${l.isNew ? '<span class="new">New</span>' : ""}</div>
              <div class="meta">${meta}</div>
              ${frac > 0.01 && !p.w ? `<div class="bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div>` : ""}
            </div>
            <button class="state" data-i="${l.i}" title="${p.w ? "Mark as unwatched" : "Mark as watched"}">
              ${p.w ? ICON.done : frac > 0.01 ? ICON.ring(frac) : ICON.empty}
            </button>
          </div>`;
      }
      listEl.innerHTML = html || `<div class="empty">No lectures match.</div>`;
    }

    function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

    function open(l) {
      if (l === current) return;
      saveNow();
      current = l;
      resumeKey = l.key;
      l.a.click(); // the site's own loader
      render();
    }

    listEl.addEventListener("click", (e) => {
      const st = e.target.closest(".state");
      if (st) {
        const l = lectures[+st.dataset.i];
        const p = progress[l.key] || (progress[l.key] = { t: 0, d: 0 });
        p.w = !p.w;
        if (!p.w) p.t = 0;
        saveNow();
        render();
        return;
      }
      const row = e.target.closest(".row");
      if (row) open(lectures[+row.dataset.i]);
    });
    $("#q").addEventListener("input", (e) => { query = e.target.value.trim(); render(); });
    $("#q").addEventListener("keydown", (e) => e.stopPropagation());
    root.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
      filter = b.dataset.f;
      root.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
      render();
    }));

    // ---------- progress & resume ----------
    let saveTimer = null;
    function saveNow() { clearTimeout(saveTimer); saveTimer = null; save({ progress }); }
    function saveSoon() { if (!saveTimer) saveTimer = setTimeout(saveNow, 4000); }

    function tryResume() {
      const v = video();
      if (!v || resumeKey !== current.key || !(v.duration > 60)) return;
      resumeKey = null;
      const p = progress[current.key];
      if (p && !p.w && p.t > 15 && p.t < v.duration - 20) {
        v.currentTime = p.t;
        document.dispatchEvent(new CustomEvent("psc-hud", { detail: "Resumed at " + fmtTime(p.t) }));
      }
    }

    function bindVideo(v) {
      if (!v || v.dataset.pscLib) return;
      v.dataset.pscLib = "1";
      v.addEventListener("loadedmetadata", tryResume);
      let lastRender = 0;
      v.addEventListener("timeupdate", () => {
        if (resumeKey || !(v.duration > 60)) return;
        const p = progress[current.key] || (progress[current.key] = { t: 0, d: 0 });
        p.t = v.currentTime; p.d = v.duration;
        if (v.currentTime / v.duration > 0.92) p.w = true;
        saveSoon();
        if (Date.now() - lastRender > 5000) { lastRender = Date.now(); render(); }
      });
      v.addEventListener("ended", () => {
        (progress[current.key] ||= { t: 0, d: v.duration }).w = true;
        saveNow(); render();
      });
      if (v.readyState >= 1) tryResume();
    }

    chrome.storage.local.get({ progress: {}, focus: false }, (d) => {
      progress = d.progress || {};
      render();
      if (d.focus) setFocus(true, false);
      bindVideo(video());
      root.querySelector(".row.cur")?.scrollIntoView({ block: "nearest" });
    });
    new MutationObserver(() => bindVideo(video())).observe(document.body, { childList: true, subtree: true });
    addEventListener("pagehide", saveNow);
  }

  // Page-level rules for focus mode (outside shadow DOM, so they can reach the site's player).
  const Z = 2147482000;
  const FOCUS_PAGE_CSS = `
    #psc-backdrop, #psc-focus-title { display: none; }
    html.psc-focus, html.psc-focus body { overflow: hidden !important; }
    html.psc-focus #psc-backdrop { display: block; position: fixed; inset: 0; z-index: ${Z}; background: #f5f5f7; }
    html.psc-focus .psc-library { position: fixed !important; z-index: ${Z + 1}; top: 24px; left: 24px; bottom: 24px;
      width: 380px; margin: 0 !important; }
    html.psc-focus #psc-focus-title { display: block; position: fixed; z-index: ${Z + 1}; top: 28px; left: 432px; right: 32px; }
    html.psc-focus [class*="defContainer_"] { position: fixed !important; z-index: ${Z + 1}; top: 92px; left: 432px; right: 32px;
      bottom: 24px; margin: 0 !important; padding: 0 !important; overflow: visible; }
    html.psc-focus [class*="defContainer_"] .video-js-box { width: 100% !important; }
    html.psc-focus [class*="defContainer_"] video { width: 100% !important; height: auto !important;
      max-height: calc(100vh - 190px); background: #000; border-radius: 14px; display: block; }
  `;

  const CSS = `
    :host { all: initial; display: block; margin-bottom: 16px; }
    :host([focus]) .lib { height: 100%; display: flex; flex-direction: column; }
    :host([focus]) .list { max-height: none; flex: 1; }
    header .focus { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 11px 0 9px; border: 0;
      border-radius: 999px; background: rgba(118,118,128,.12); color: #1d1d1f; font: 600 12px/1 inherit;
      font-family: inherit; cursor: pointer; transition: background .15s ease; }
    header .focus:hover { background: rgba(118,118,128,.2); }
    header .focus svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    header .focus .exit, :host([focus]) header .focus .enter { display: none; }
    :host([focus]) header .focus .exit { display: inline; }
    :host([focus]) header .focus svg.exit { display: block; }
    * { box-sizing: border-box; }
    .lib { font: 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
           color: #1d1d1f; -webkit-font-smoothing: antialiased; background: #fff; border-radius: 16px;
           box-shadow: 0 0 0 .5px rgba(0,0,0,.08), 0 4px 18px rgba(0,0,0,.06); overflow: hidden; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 18px 18px 10px; }
    .h { font-size: 22px; font-weight: 700; letter-spacing: -.02em; }
    .sub { color: #86868b; margin-top: 2px; }
    .tools { display: flex; gap: 8px; padding: 0 18px 12px; }
    .search { flex: 1; display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px;
              background: rgba(118,118,128,.12); border-radius: 9px; }
    .search svg { width: 15px; height: 15px; fill: none; stroke: #86868b; stroke-width: 2; stroke-linecap: round; flex: none; }
    .search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; color: inherit; }
    .search input::placeholder { color: #86868b; }
    .seg { display: flex; padding: 2px; background: rgba(118,118,128,.12); border-radius: 9px; }
    .seg button { border: 0; background: transparent; font: 500 12px/1 inherit; font-family: inherit; color: #1d1d1f;
                  padding: 0 10px; border-radius: 7px; cursor: pointer; }
    .seg button.on { background: #fff; box-shadow: 0 3px 8px rgba(0,0,0,.12), 0 3px 1px rgba(0,0,0,.04); font-weight: 600; }
    .list { max-height: calc(100vh - 230px); min-height: 200px; overflow-y: auto; padding: 0 8px 10px; }
    .month { position: sticky; top: 0; z-index: 1; background: rgba(255,255,255,.92);
             backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
             padding: 12px 10px 6px; font-size: 12px; font-weight: 600; color: #86868b; letter-spacing: .02em; }
    .row { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 12px; cursor: pointer;
           transition: background .12s ease; }
    .row:hover { background: rgba(0,0,0,.035); }
    .row.cur { background: rgba(0,113,227,.09); }
    .num { width: 26px; flex: none; color: #86868b; font-weight: 600; font-variant-numeric: tabular-nums; font-size: 12px; }
    .row.cur .num { color: #0071e3; }
    .body { flex: 1; min-width: 0; }
    .title { font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .row.done .title { color: #6e6e73; font-weight: 500; }
    .new { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 6px; vertical-align: 1px;
           background: #0071e3; color: #fff; font-size: 10.5px; font-weight: 600; letter-spacing: .02em; }
    .meta { margin-top: 3px; color: #86868b; font-size: 12px; font-variant-numeric: tabular-nums; }
    .bar { margin-top: 7px; height: 3px; border-radius: 2px; background: rgba(118,118,128,.2); overflow: hidden; }
    .bar i { display: block; height: 100%; background: #0071e3; border-radius: 2px; }
    .state { flex: none; width: 28px; height: 28px; border: 0; background: transparent; padding: 2px; cursor: pointer; border-radius: 50%; }
    .state:hover { background: rgba(0,0,0,.06); }
    .state svg { width: 24px; height: 24px; display: block; }
    .state .track { fill: none; stroke: rgba(118,118,128,.35); stroke-width: 1.8; }
    .state .arc { fill: none; stroke: #0071e3; stroke-width: 2.4; stroke-linecap: round; }
    .state .fill { fill: #34c759; }
    .state .tick { fill: none; stroke: #fff; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .empty { padding: 30px 10px; text-align: center; color: #86868b; }
  `;
})();
