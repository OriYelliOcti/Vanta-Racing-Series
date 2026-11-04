/* Fantasy championship: build a team, lock in, get a code for /fantasy in Discord. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    const results = await VRS.json("data/results.json");
    const lineups = await VRS.json("data/lineups.json");
    const published = await VRS.json("data/fantasy.json");
    VRS.shell(cfg, "fantasy.html");

    const rounds = results.rounds || [];
    const divisions = cfg.divisions || ["F1", "F2"];
    const picks = { drivers: [], constructor: "" };
    const STORE = "vrs.fantasy.v1";

    const standings = new Map();
    for (const division of divisions) {
      const table = VRS.computeStandings(rounds, cfg, division);
      table.drivers.forEach((row) => standings.set(row.driver, { ...row, division }));
    }
    const drivers = [...standings.values()].sort((a, b) => b.points - a.points);
    const teamLabel = (key) => VRS.teamName(lineups, key);

    host.innerHTML = `${VRS.demoBanner(rounds)}
      <h1>Fantasy championship</h1>
      <p class="lead">Pick two drivers and one constructor. When you lock in, the page
      gives you a code — submit it in Discord with
      <code>/fantasy code: VRS-XXXXX</code> so it reaches the stewards' sheet.
      Points are matched against the same results the race centre uses.</p>

      <div class="grid2">
        <div class="card">
          <h2 style="margin-top:0">Build your team</h2>
          <div id="builder"></div>
          <div class="row" style="margin-top:14px">
            <button class="primary" id="lockIn" disabled>Lock in and get my code</button>
            <button id="reset">Clear</button>
          </div>
          <div id="result" style="margin-top:14px"></div>
        </div>
        <div class="card">
          <h2 style="margin-top:0">Your projection</h2>
          <div class="stats" id="projection"></div>
          <p class="small muted" style="margin-top:12px">Projection sums the points your
          picks have scored so far this season.</p>
        </div>
      </div>

      <h2>Submitted teams</h2>
      <div id="entries"></div>`;

    function driverOptions(selected) {
      return drivers
        .map((d) => {
          const disabled = !selected.includes(d.driver) && selected.length >= 2;
          return `<option value="${VRS.esc(d.driver)}" ${
            selected.includes(d.driver) ? "selected" : ""
          } ${disabled ? "disabled" : ""}>${VRS.esc(d.driver)} · ${VRS.esc(
            d.division
          )} · ${d.points} pts</option>`;
        })
        .join("");
    }

    function constructorOptions(selected) {
      const teams = (lineups.teams || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      return teams
        .map(
          (t) =>
            `<option value="${VRS.esc(t.key)}" ${
              t.key === selected ? "selected" : ""
            }>${VRS.esc(t.name)} · ${VRS.esc(t.division)}</option>`
        )
        .join("");
    }

    function renderBuilder() {
      const taken = picks.drivers.filter(Boolean);
      document.getElementById("builder").innerHTML = `
        <label class="field"><span>Driver 1</span>
          <select id="d1"><option value="">—</option>${driverOptions(taken)}</select></label>
        <label class="field"><span>Driver 2</span>
          <select id="d2"><option value="">—</option>${driverOptions(taken)}</select></label>
        <label class="field"><span>Constructor</span>
          <select id="c1"><option value="">—</option>${constructorOptions(picks.constructor)}</select></label>`;

      ["d1", "d2"].forEach((id) => {
        const select = document.getElementById(id);
        select.value = picks.drivers[id === "d1" ? 0 : 1] || "";
        select.addEventListener("change", () => {
          const index = id === "d1" ? 0 : 1;
          picks.drivers[index] = select.value;
          afterChange();
        });
      });
      const c1 = document.getElementById("c1");
      c1.value = picks.constructor;
      c1.addEventListener("change", () => {
        picks.constructor = c1.value;
        afterChange();
      });
    }

    function pointsOfPick() {
      const driversPoints = picks.drivers
        .filter(Boolean)
        .reduce((sum, name) => sum + ((standings.get(name) || {}).points || 0), 0);
      const teamPoints =
        (VRS.computeStandings(rounds, cfg, "F1").teams.find((t) => t.team === picks.constructor) ||
          { points: 0 }).points ||
        (VRS.computeStandings(rounds, cfg, "F2").teams.find((t) => t.team === picks.constructor) ||
          { points: 0 }).points;
      return { driversPoints, teamPoints, total: driversPoints + teamPoints };
    }

    function renderProjection() {
      const { driversPoints, teamPoints, total } = pointsOfPick();
      document.getElementById("projection").innerHTML = `
        <div class="stat"><b>${driversPoints}</b><span>from drivers</span></div>
        <div class="stat"><b>${teamPoints}</b><span>from constructor</span></div>
        <div class="stat"><b>${total}</b><span>projected total</span></div>`;
    }

    function afterChange() {
      const ready = picks.drivers.filter(Boolean).length === 2 && picks.constructor;
      document.getElementById("lockIn").disabled = !ready;
      renderProjection();
    }

    function code(picksValue) {
      const raw = [picksValue.drivers.join("|"), picksValue.constructor]
        .join("|")
        .toLowerCase();
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
      document.getElementById("result").innerHTML = `
        <div class="ok"><b>Locked in.</b> Your code is
        <span class="codebox">${VRS.esc(entry.code)}</span><br>
        <span class="small">Submit it in Discord with
        <code>/fantasy code: ${VRS.esc(entry.code)}</code> — entry saved in this browser on
        ${VRS.esc(new Date(entry.lockedAt).toLocaleString())}.</span></div>`;
      picks.drivers = entry.drivers.slice();
      picks.constructor = entry.constructor;
      renderBuilder();
      afterChange();
    }

    document.getElementById("lockIn").addEventListener("click", () => {
      const entry = {
        code: code(picks),
        drivers: picks.drivers.slice(),
        constructor: picks.constructor,
        lockedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORE, JSON.stringify(entry));
      showSaved();
    });

    document.getElementById("reset").addEventListener("click", () => {
      localStorage.removeItem(STORE);
      picks.drivers = [];
      picks.constructor = "";
      document.getElementById("result").innerHTML = "";
      renderBuilder();
      afterChange();
    });

    function renderEntries() {
      const entries = published.entries || [];
      if (!entries.length) {
        document.getElementById("entries").innerHTML = `<div class="card muted">
          No fantasy teams have been published yet. The stewards import the codes from
          Discord; until then this table stays empty.</div>`;
        return;
      }
      const rows = entries
        .map((entry) => {
          const driverPoints = (entry.drivers || []).reduce(
            (sum, name) => sum + ((standings.get(name) || {}).points || 0),
            0
          );
          const teamPoints =
            (VRS.computeStandings(rounds, cfg, "F1").teams.find(
              (t) => t.team === entry.constructor
            ) || { points: 0 }).points;
          return { ...entry, points: driverPoints + teamPoints };
        })
        .sort((a, b) => b.points - a.points);

      document.getElementById("entries").innerHTML = `<table>
        <thead><tr><th class="pos">#</th><th>Code</th><th>Owner</th><th>Drivers</th>
        <th>Constructor</th><th class="num">Pts</th></tr></thead>
        <tbody>${rows
          .map(
            (row, i) => `<tr>
              <td class="pos">${i + 1}</td>
              <td><b>${VRS.esc(row.code)}</b></td>
              <td>${VRS.esc(row.owner || "—")}</td>
              <td class="muted">${VRS.esc((row.drivers || []).join(", "))}</td>
              <td class="muted">${VRS.esc(teamLabel(row.constructor))}</td>
              <td class="num"><b>${row.points}</b></td></tr>`
          )
          .join("")}</tbody></table>`;
    }

    renderBuilder();
    afterChange();
    showSaved();
    renderEntries();
  } catch (error) {
    VRS.fail(host, error);
  }
})();
