/* Shared helpers: data loading, shell, scoring. No build step, no framework. */
const VRS = (() => {
  const cache = new Map();

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
    ["races.html", "Race centre"],
    ["fantasy.html", "Fantasy"],
    ["schedule.html", "Calendar"],
    ["stewards.html", "Stewarding"],
  ];

  function shell(cfg, active) {
    const links = NAV.map(
      ([href, label]) =>
        `<a href="${href}" class="${href === active ? "on" : ""}">${label}</a>`
    ).join("");
    const header = `<header class="top"><div class="bar">
      <div class="brand">VANTA <span>RACING</span> SERIES</div>
      <nav>${links}</nav></div></header>`;
    document.body.insertAdjacentHTML("afterbegin", header);
    const footer = `<footer>${esc(cfg.league || "Vanta Racing Series")} · season ${
      esc(cfg.season || "")
    } · built from Discord roles and race data</footer>`;
    document.body.insertAdjacentHTML("beforeend", footer);
  }

  const divisionChip = (division) =>
    `<span class="chip ${division === "F1" ? "f1" : "f2"}">${esc(division)}</span>`;

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

  function fail(host, error) {
    host.innerHTML = `<div class="err"><b>Could not load the data.</b><br>${esc(
      error.message
    )}<br><span class="small">If you opened this file directly, serve it over HTTP
    (<code>python -m http.server</code>) — <code>fetch</code> cannot read JSON from
    <code>file://</code>.</span></div>`;
    console.error(error);
  }

  return { json, esc, shell, divisionChip, demoBanner, computeStandings, rowPoints, teamName, fail };
})();

window.VRS = VRS;
