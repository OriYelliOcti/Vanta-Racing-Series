/* Shared helpers: data loading, shell, theme, scoring. No build step, no framework. */
const VRS = (() => {
  const cache = new Map();

  // Theme first: set before anything renders so the page never flashes.
  const THEME_KEY = "vrs-theme";
  function storedTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (e) {
      return null;
    }
  }
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = theme === "light" ? "🌙 Dark" : "☀️ Light";
      btn.setAttribute("aria-label", theme === "light" ? "Switch to dark theme" : "Switch to light theme");
    }
  }
  function initTheme() {
    const saved = storedTheme();
    const system = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
    applyTheme(saved === "light" || saved === "dark" ? saved : system);
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* private mode: the toggle still works for this page */
    }
    applyTheme(next);
  }
  initTheme();

  async function json(path) {
    if (cache.has(path)) return cache.get(path);
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} — HTTP ${res.status}`);
    const data = await res.json();
    cache.set(path, data);
    return data;
  }

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const NAV = [
    ["index.html", "Home"],
    ["grid.html", "The grid"],
    ["seats.html", "Seat board"],
    ["races.html", "Race centre"],
    ["fantasy.html", "Fantasy"],
    ["schedule.html", "Calendar"],
    ["news.html", "News"],
    ["rules.html", "Rules"],
  ];

  // The FIA desk is the extra door: not in the navigation, opened by this hash.
  if (
    location.hash.toLowerCase() === "#vrs-fia" &&
    !/stewards\.html$/.test(location.pathname)
  ) {
    location.replace("stewards.html#vrs-FIA");
  }

  function shell(cfg, active) {
    const links = NAV.map(
      ([href, label]) =>
        `<a href="${href}" class="${href === active ? "on" : ""}">${label}</a>`
    ).join("");
    const header = `<header class="top"><div class="topbar">
      <a class="brand" href="index.html" aria-label="Vanta Racing Series home">
        <img src="assets/vanta-logo.png?v=20261120" alt="Vanta Racing Series"
          width="900" height="184">
      </a>
      <button class="themebtn" id="themeToggle" type="button">Light</button>
      <nav>${links}</nav></div></header>`;
    document.body.insertAdjacentHTML("afterbegin", header);
    const toggle = document.getElementById("themeToggle");
    if (toggle) toggle.addEventListener("click", toggleTheme);
    applyTheme(document.documentElement.dataset.theme || "dark");
    const footer = `<footer>
      <div>${esc(cfg.league || "Vanta Racing Series")} · season ${esc(
      cfg.season || ""
    )} · built from Discord roles and race data</div>
      <div class="partner">
        <img class="partner-mark" src="assets/partner-tarigys-shield.png?v=20261127a"
          alt="" width="180" height="111">
        <span class="partner-text">
          <span class="partner-label">Official partner</span>
          <img class="partner-word" src="assets/partner-tarigys-wordmark.png?v=20261127a"
            alt="Tarigy's Motorsport" width="360" height="51">
        </span>
      </div>
    </footer>`;
    document.body.insertAdjacentHTML("beforeend", footer);
  }

  const divisionChip = (division) =>
    `<span class="chip ${
      division === "F1" ? "f1" : division === "F2" ? "f2" : "org"
    }">${esc(division)}</span>`;

  /** Team colours live in data/teams.json so the lineup sync cannot wipe them. */
  let palettePromise = null;
  function palette() {
    if (!palettePromise) {
      palettePromise = json("data/teams.json")
        .then((data) => data.teams || {})
        .catch(() => ({}));
    }
    return palettePromise;
  }
  const colorOf = (pal, key) => (pal && pal[key] && pal[key].color) || "#7a8698";
  const codeOf = (pal, key) => (pal && pal[key] && pal[key].code) || "";

  function demoBanner(rounds) {
    if (!rounds.some((r) => r.demo)) return "";
    return `<div class="warn" style="margin:0 0 18px">
      <b>Demo data.</b> The rounds flagged <code>demo: true</code> in
      <code>data/results.json</code> are placeholders so the tables have something
      to show. Delete them before the first real race weekend.
    </div>`;
  }

  /**
   * Points for one round row: race points by position + fastest lap + pole.
   */
  function rowPoints(row, cfg) {
    const table = (cfg.scoring && cfg.scoring.race) || [];
    let points = table[row.pos - 1] || 0;
    if (row.fastestLap) points += (cfg.scoring && cfg.scoring.fastestLap) || 0;
    if (row.pole) points += (cfg.scoring && cfg.scoring.pole) || 0;
    return points;
  }

  /**
   * Driver and constructor standings for one division, from every round.
   */
  function computeStandings(rounds, cfg, division) {
    const drivers = new Map();
    const teams = new Map();

    for (const round of rounds) {
      const rows = ((round.divisions || {})[division] || []).slice();
      for (const row of rows) {
        const points = rowPoints(row, cfg);

        const driver = drivers.get(row.driver) || {
          driver: row.driver,
          team: row.team,
          points: 0,
          starts: 0,
          wins: 0,
          podiums: 0,
          best: 99,
        };
        driver.points += points;
        driver.starts += 1;
        driver.best = Math.min(driver.best, row.pos);
        if (row.pos === 1) driver.wins += 1;
        if (row.pos <= 3) driver.podiums += 1;
        if (row.team) driver.team = row.team;
        drivers.set(row.driver, driver);

        const team = teams.get(row.team) || { team: row.team, points: 0, wins: 0, podiums: 0 };
        team.points += points;
        if (row.pos === 1) team.wins += 1;
        if (row.pos <= 3) team.podiums += 1;
        teams.set(row.team, team);
      }
    }

    const order = (a, b) => b.points - a.points || b.wins - a.wins || a.best - b.best;
    return {
      drivers: [...drivers.values()].sort(order),
      teams: [...teams.values()].sort((a, b) => b.points - a.points || b.wins - a.wins),
      rounds: rounds.filter((r) => ((r.divisions || {})[division] || []).length).length,
    };
  }

  function teamName(lineups, key) {
    const team = (lineups.teams || []).find((t) => t.key === key);
    return team ? team.name : key;
  }

  /**
   * The next session: the earliest future round with a date, else cfg.nextEvent.
   * Returns null when nothing is scheduled — the page then says so instead of guessing.
   */
  function nextEvent(schedule, cfg) {
    const now = Date.now();
    const dated = (schedule.rounds || [])
      .filter((r) => r.date && new Date(r.date).getTime() > now)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    if (dated.length) {
      const r = dated[0];
      return {
        title: `${r.flag || "🏁"} ${r.circuit || "TBA"}`,
        subtitle: `Round ${r.round}${r.country ? " · " + r.country : ""}`,
        date: r.date,
        note: r.note || "",
      };
    }
    const e = cfg.nextEvent;
    if (e && e.start && new Date(e.start).getTime() > now) {
      return {
        title: `${e.flag || "🏁"} ${e.label || "Next session"}`,
        subtitle: e.circuit || "",
        date: e.start,
        note: e.detail || "",
      };
    }
    return null;
  }

  /** Countdown markup plus a one-second ticker that replaces itself in place. */
  function countdown(event) {
    if (!event) {
      return `<div class="countdown">
        <div class="cdlabel">Next session</div>
        <div class="cdtitle">No date set yet</div>
        <p class="small muted" style="margin:0">Rounds get a date once the grid is
        there. Until then the calendar is the track list.</p>
      </div>`;
    }
    const id = "cd" + Math.random().toString(36).slice(2, 8);
    const when = new Date(event.date);
    const stamp = when.toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
    const box = `<div class="countdown" id="${id}" data-at="${esc(event.date)}">
      <div class="cdlabel">Next session</div>
      <div class="cdtitle">${esc(event.title)}</div>
      <div class="small muted">${esc(event.subtitle)}${event.subtitle && stamp ? " · " : ""}${esc(stamp)}${event.note ? " · " + esc(event.note) : ""}</div>
      <div class="cdgrid">
        <div class="cdcell"><b data-u="d">0</b><span>days</span></div>
        <div class="cdcell"><b data-u="h">0</b><span>hours</span></div>
        <div class="cdcell"><b data-u="m">0</b><span>min</span></div>
        <div class="cdcell"><b data-u="s">0</b><span>sec</span></div>
      </div>
    </div>`;
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const target = new Date(el.dataset.at).getTime();
      const tick = () => {
        const left = target - Date.now();
        if (left <= 0) {
          const grid = el.querySelector(".cdgrid");
          if (grid) grid.outerHTML = `<div class="cddone">Under way — good luck.</div>`;
          return false;
        }
        const s = Math.floor(left / 1000);
        const parts = {
          d: Math.floor(s / 86400),
          h: Math.floor((s % 86400) / 3600),
          m: Math.floor((s % 3600) / 60),
          s: s % 60,
        };
        for (const [unit, value] of Object.entries(parts)) {
          const cell = el.querySelector(`[data-u="${unit}"]`);
          if (cell) cell.textContent = String(value).padStart(2, "0");
        }
        return true;
      };
      if (tick()) {
        const timer = setInterval(() => {
          if (!document.body.contains(el) || !tick()) clearInterval(timer);
        }, 1000);
      }
    }, 0);
    return box;
  }

  function fail(host, error) {
    host.innerHTML = `<div class="err"><b>Could not load the data.</b><br>${esc(
      error.message
    )}<br><span class="small">If you opened this file directly, serve it over HTTP
    (<code>python -m http.server</code>) — <code>fetch</code> cannot read JSON from
    <code>file://</code>.</span></div>`;
    console.error(error);
  }

  return {
    json, esc, shell, divisionChip, demoBanner, computeStandings, rowPoints, teamName,
    palette, colorOf, codeOf, nextEvent, countdown, fail, applyTheme, toggleTheme,
  };
})();

window.VRS = VRS;
