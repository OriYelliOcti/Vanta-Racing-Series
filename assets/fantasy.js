/* Fantasy championship: two drivers, their points count 1:1, code for Discord. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const results = await VRS.json("data/results.json");
    const lineups = await VRS.json("data/lineups.json");
    const published = await VRS.json("data/fantasy.json");
    const pal = await VRS.palette();
    VRS.shell(cfg, "fantasy.html");

    const rounds = results.rounds || [];
    const divisions = cfg.divisions || ["F1", "F2"];
    const STORE = "vrs.fantasy.v1";
    const PICKS = 2;

    let picks = [];

    const standings = new Map();
    for (const division of divisions) {
      const table = VRS.computeStandings(rounds, cfg, division);
      table.drivers.forEach((row) => standings.set(row.driver, { ...row, division }));
    }

    // Picks come from the published lineups, so it is playable before the first race.
    const roster = new Map();
    for (const team of lineups.teams || []) {
      if (!divisions.includes(team.division)) continue;
      for (const member of (((team.slots || {}).driver || {}).members || [])) {
        const scored = standings.get(member.name) || {};
        roster.set(member.name, {
          driver: member.name,
          team: team.key,
          division: team.division,
          points: scored.points || 0,
        });
      }
    }
    const drivers = [...roster.values()].sort(
      (a, b) => b.points - a.points || a.driver.localeCompare(b.driver)
    );
    const pointsOf = (name) => (roster.get(name) || {}).points || 0;

    host.innerHTML = `${VRS.demoBanner(rounds)}
      <h1>Fantasy championship</h1>
      <p class="lead">Pick two drivers. Their championship points are your points, one to
      one — no multipliers, no constructor, no clever maths. Lock in and you get a code to
      submit in Discord with <code>/fantasy code: VRS-XXXXX</code>.</p>

      <div class="grid2">
        <div class="card">
          <h2 style="margin-top:0">Your two drivers</h2>
          <div id="builder"></div>
          <div class="row" style="margin-top:14px">
            <button class="primary" id="lockIn" disabled>Lock in and get my code</button>
            <button id="reset">Clear</button>
          </div>
          <div id="result" style="margin-top:14px"></div>
        </div>
        <div class="card">
          <h2 style="margin-top:0">Your score</h2>
          <div class="stats" id="projection"></div>
          <p class="small muted" style="margin-top:12px">Exactly the points your two drivers
          have scored so far. Nothing is added, nothing is doubled.</p>
          <div id="picked" style="margin-top:12px"></div>
        </div>
      </div>

      <h2>Fantasy table</h2>
      <div id="entries"></div>`;

    function options(selected, index) {
      return drivers
        .map((d) => {
          const other = selected.findIndex((name, i) => i !== index && name === d.driver) !== -1;
          return `<option value="${VRS.esc(d.driver)}" ${
            selected[index] === d.driver ? "selected" : ""
          } ${other ? "disabled" : ""}>${VRS.esc(d.driver)} · ${VRS.esc(d.division)} · ${
            d.points
          } pts</option>`;
        })
        .join("");
    }

    function renderBuilder() {
      if (!drivers.length) {
        document.getElementById("builder").innerHTML = `<div class="warn">No drivers are
        published yet. The grid fills up as teams sign drivers in Discord.</div>`;
        return;
      }
      document.getElementById("builder").innerHTML = picks
        .map(
          (value, index) => `<label class="field"><span>Driver ${index + 1}</span>
            <select data-pick="${index}"><option value="">—</option>${options(picks, index)}</select>
          </label>`
        )
        .join("");
      document.querySelectorAll("[data-pick]").forEach((select) => {
        select.value = picks[Number(select.dataset.pick)] || "";
        select.addEventListener("change", () => {
          picks[Number(select.dataset.pick)] = select.value;
          renderBuilder();
          afterChange();
        });
      });
    }

    function renderProjection() {
      const chosen = picks.filter(Boolean);
      const total = chosen.reduce((sum, name) => sum + pointsOf(name), 0);
      document.getElementById("projection").innerHTML = `
        <div class="stat"><b>${chosen.length}/${PICKS}</b><span>drivers picked</span></div>
        <div class="stat"><b>${total}</b><span>points</span></div>`;
      document.getElementById("picked").innerHTML = chosen.length
        ? `<ul class="list">${chosen
            .map((name) => {
              const row = roster.get(name) || {};
              return `<li class="spread"><span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${VRS.colorOf(
                pal,
                row.team
              )};margin-right:7px"></span><b>${VRS.esc(name)}</b>
              <span class="small muted"> · ${VRS.esc(VRS.teamName(lineups, row.team))}</span></span>
              <span class="small"><b>${pointsOf(name)}</b> pts</span></li>`;
            })
            .join("")}</ul>`
        : "";
    }

    function afterChange() {
      const ready = picks.filter(Boolean).length === PICKS;
      const lock = document.getElementById("lockIn");
      if (lock) lock.disabled = !ready;
      renderProjection();
    }

    function code(value) {
      const raw = value.filter(Boolean).join("|").toLowerCase();
      let hash = 2166136261;
      for (let i = 0; i < raw.length; i += 1) {
        hash ^= raw.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let n = Math.abs(hash);
      let out = "";
      for (let i = 0; i < 5; i += 1) {
        out += alphabet[n % alphabet.length];
        n = Math.floor(n / alphabet.length);
      }
      return `VRS-${out}`;
    }

    function saved() {
      try {
        return JSON.parse(localStorage.getItem(STORE) || "null");
      } catch {
        return null;
      }
    }

    function showSaved() {
      const entry = saved();
      if (!entry) return;
      picks = (entry.drivers || []).slice(0, PICKS);
      document.getElementById("result").innerHTML = `
        <div class="ok"><b>Locked in.</b> Your code is
        <span class="codebox">${VRS.esc(entry.code)}</span><br>
        <span class="small">Submit it in Discord with
        <code>/fantasy code: ${VRS.esc(entry.code)}</code> — saved in this browser on
        ${VRS.esc(new Date(entry.lockedAt).toLocaleString())}.</span></div>`;
      renderBuilder();
      afterChange();
    }

    document.getElementById("lockIn").addEventListener("click", () => {
      const entry = {
        code: code(picks),
        drivers: picks.filter(Boolean),
        lockedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORE, JSON.stringify(entry));
      showSaved();
    });

    document.getElementById("reset").addEventListener("click", () => {
      localStorage.removeItem(STORE);
      picks = [];
      document.getElementById("result").innerHTML = "";
      renderBuilder();
      afterChange();
    });

    function renderEntries() {
      const entries = published.entries || [];
      if (!entries.length) {
        document.getElementById("entries").innerHTML = `<div class="card muted">
          No fantasy teams published yet. The stewards import the codes from Discord; until
          then this table stays empty.</div>`;
        return;
      }
      const rows = entries
        .map((entry) => ({
          ...entry,
          points: (entry.drivers || []).reduce((sum, name) => sum + pointsOf(name), 0),
        }))
        .sort((a, b) => b.points - a.points);
      document.getElementById("entries").innerHTML = `<table>
        <thead><tr><th class="pos">#</th><th>Code</th><th>Owner</th><th>Drivers</th>
        <th class="num">Pts</th></tr></thead>
        <tbody>${rows
          .map(
            (row, i) => `<tr><td class="pos">${i + 1}</td>
              <td><b>${VRS.esc(row.code)}</b></td>
              <td>${VRS.esc(row.owner || "—")}</td>
              <td class="muted">${VRS.esc((row.drivers || []).join(", "))}</td>
              <td class="num"><b>${row.points}</b></td></tr>`
          )
          .join("")}</tbody></table>`;
    }

    picks = [];
    renderBuilder();
    afterChange();
    showSaved();
    renderEntries();
  } catch (error) {
    VRS.fail(host, error);
  }
})();
