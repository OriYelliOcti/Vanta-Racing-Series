/* Race centre: timing sheet, standings for drivers and constructors. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const results = await VRS.json("data/results.json");
    const lineups = await VRS.json("data/lineups.json");
    VRS.shell(cfg, "races.html");

    const rounds = results.rounds || [];
    const divisions = cfg.divisions || ["F1", "F2"];
    let division = divisions[0];

    host.innerHTML = `${VRS.demoBanner(rounds)}
      <h1>Race centre</h1>
      <p class="lead">Points are calculated in the browser from the published
      results — race points by position, plus fastest lap${
        (cfg.scoring && cfg.scoring.pole) ? " and pole" : ""
      }. Nothing is fetched from a server at race time.</p>
      <div class="tabs" id="tabs">
        ${divisions.map((d) => `<button data-division="${VRS.esc(d)}" class="${d === division ? "on" : ""}">${VRS.esc(d)}</button>`).join("")}
      </div>
      <div class="stats" id="summary" style="margin-bottom:18px"></div>
      <div class="grid2">
        <div class="card"><h2 style="margin-top:0">Drivers</h2><div id="drivers"></div></div>
        <div class="card"><h2 style="margin-top:0">Constructors</h2><div id="constructors"></div></div>
      </div>
      <h2>Timing sheet</h2>
      <div id="sheets"></div>`;

    const teamLabel = (key) => VRS.teamName(lineups, key);

    function renderSummary(table) {
      const leader = table.drivers[0];
      const roundsRun = table.rounds;
      document.getElementById("summary").innerHTML = `
        <div class="stat"><b>${roundsRun}</b><span>rounds scored</span></div>
        <div class="stat"><b>${VRS.esc(leader ? leader.driver : "—")}</b><span>championship leader</span></div>
        <div class="stat"><b>${leader ? leader.points : 0}</b><span>points on top</span></div>
        <div class="stat"><b>${table.drivers.reduce((n, d) => n + d.wins, 0)}</b><span>wins handed out</span></div>`;
    }

    function renderDrivers(table) {
      if (!table.drivers.length) {
        document.getElementById("drivers").innerHTML = `<p class="muted">No results yet.</p>`;
        return;
      }
      document.getElementById("drivers").innerHTML = `<table>
        <thead><tr><th class="pos">#</th><th>Driver</th><th>Team</th>
        <th class="num">Starts</th><th class="num">Wins</th><th class="num">Podiums</th>
        <th class="num">Best</th><th class="num">Pts</th></tr></thead>
        <tbody>${table.drivers
          .map(
            (d, i) => `<tr>
            <td class="pos">${i + 1}</td>
            <td>${VRS.esc(d.driver)}</td>
            <td class="muted">${VRS.esc(teamLabel(d.team))}</td>
            <td class="num">${d.starts}</td>
            <td class="num">${d.wins}</td>
            <td class="num">${d.podiums}</td>
            <td class="num">${d.best === 99 ? "—" : d.best}</td>
            <td class="num"><b>${d.points}</b></td></tr>`
          )
          .join("")}</tbody></table>`;
    }

    function renderTeams(table) {
      if (!table.teams.length) {
        document.getElementById("constructors").innerHTML = `<p class="muted">No results yet.</p>`;
        return;
      }
      document.getElementById("constructors").innerHTML = `<table>
        <thead><tr><th class="pos">#</th><th>Constructor</th>
        <th class="num">Wins</th><th class="num">Podiums</th><th class="num">Pts</th></tr></thead>
        <tbody>${table.teams
          .map(
            (t, i) => `<tr>
            <td class="pos">${i + 1}</td>
            <td>${VRS.esc(teamLabel(t.team))}</td>
            <td class="num">${t.wins}</td>
            <td class="num">${t.podiums}</td>
            <td class="num"><b>${t.points}</b></td></tr>`
          )
          .join("")}</tbody></table>`;
    }

    function renderSheets() {
      const scored = rounds.filter((r) => ((r.divisions || {})[division] || []).length);
      if (!scored.length) {
        document.getElementById("sheets").innerHTML =
          `<div class="card muted">No timing sheet for ${VRS.esc(division)} yet.</div>`;
        return;
      }
      document.getElementById("sheets").innerHTML = scored
        .slice()
        .reverse()
        .map((round) => {
          const rows = round.divisions[division].slice().sort((a, b) => a.pos - b.pos);
          return `<div class="card" style="margin-bottom:12px">
            <div class="spread" style="margin-bottom:8px">
              <h3>R${VRS.esc(round.round)} · ${VRS.esc(round.name || "")}</h3>
              <span class="small muted">${VRS.esc(round.date || "")}${
                round.demo ? ' · <span class="chip demo">demo</span>' : ""
              }</span>
            </div>
            <table><thead><tr><th class="pos">#</th><th>Driver</th><th>Team</th>
              <th class="num">Pts</th><th>Notes</th></tr></thead>
            <tbody>${rows
              .map((row) => {
                const notes = [];
                if (row.fastestLap) notes.push("fastest lap");
                if (row.pole) notes.push("pole");
                if (row.note) notes.push(VRS.esc(row.note));
                return `<tr>
                  <td class="pos">${row.pos}</td>
                  <td>${VRS.esc(row.driver)}</td>
                  <td class="muted">${VRS.esc(teamLabel(row.team))}</td>
                  <td class="num">${VRS.rowPoints(row, cfg)}</td>
                  <td class="small muted">${notes.join(" · ")}</td></tr>`;
              })
              .join("")}</tbody></table>
          </div>`;
        })
        .join("");
    }

    function renderAll() {
      const table = VRS.computeStandings(rounds, cfg, division);
      renderSummary(table);
      renderDrivers(table);
      renderTeams(table);
      renderSheets();
    }

    document.getElementById("tabs").addEventListener("click", (event) => {
      const button = event.target.closest("button[data-division]");
      if (!button) return;
      division = button.dataset.division;
      [...document.querySelectorAll("#tabs button")].forEach((b) =>
        b.classList.toggle("on", b === button)
      );
      renderAll();
    });

    renderAll();
  } catch (error) {
    VRS.fail(host, error);
  }
})();
