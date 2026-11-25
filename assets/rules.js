/* The rulebook, readable without Discord. Numbers come from data/config.json. */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    VRS.shell(cfg, "rules.html");

    const fmt = cfg.format || {};
    const money = (n) =>
      n >= 1000000 ? `${(n / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M` : `${n}`;
    const points = ((cfg.scoring && cfg.scoring.race) || []).join("-");
    const prize = (cfg.prizeMoney || []).map((v, i) => `P${i + 1} ${money(v)}`).join(" · ");
    const fees = cfg.entryFees || {};

    host.innerHTML = `
      <h1>The rules</h1>
      <p class="lead">Everything that decides a race weekend, on one page. If a rule is
      missing here it is not a rule yet.</p>

      <div class="rules">
        <div class="card">
          <h2>The league</h2>
          <p>Vanta Racing Series is a Roblox racing league run in <b>Formula Venturi 26</b>,
          with two divisions — <b>F1</b> and <b>F2</b> — and 22 teams. Every team carries a
          budget, every signing costs it, and every seat is written down.</p>
          <p>Seats come from Discord roles: the lineup on this site is the same list the
          stewards work from.</p>
        </div>

        <div class="card">
          <h2>Entry and money</h2>
          <div class="kv">
            <span>F1 entry</span><b>${VRS.esc(money(fees.F1 || 0))}</b>
            <span>F2 entry</span><b>${VRS.esc(money(fees.F2 || 0))}</b>
            <span>Team boss seat</span><b>${VRS.esc(money(fees.boss || 0))}</b>
          </div>
          <p style="margin-top:10px">Prize money is paid by finishing position:
          <b>${VRS.esc(prize)}</b>.</p>
        </div>

        <div class="card">
          <h2>The grid</h2>
          <p>Each team has <b>eleven seats</b>: owner, team principal, engineer, two
          drivers, two reserves and four pit crew.</p>
          <p>Only the <b>two drivers</b> race. A Roblox server holds 50 players including
          the FIA and the host, which is exactly one full field of drivers plus the desk —
          the other nine seats are the team behind the car.</p>
          <p>Teams without an owner are run by the <b>FIA</b> until someone buys them.</p>
        </div>

        <div class="card">
          <h2>A race weekend</h2>
          <div class="kv">
            <span>Day</span><b>${VRS.esc(fmt.raceDay || "Saturday")}</b>
            <span>Qualifying</span><b>${VRS.esc(fmt.qualiStart || "15:00 UTC")} · ${VRS.esc(
      fmt.qualiMinutes || 10
    )} minutes</b>
            <span>Race</span><b>~${VRS.esc(fmt.raceMinutes || 20)} minutes</b>
            <span>Pre-season test race</span><b>~${VRS.esc(fmt.testRaceMinutes || 15)} minutes</b>
          </div>
          <p style="margin-top:10px">Qualifying is one session and your <b>best lap
          counts</b>. The grid is set from it directly.</p>
        </div>

        <div class="card">
          <h2>Points</h2>
          <p><b>${VRS.esc(points)}</b> for the top ten, plus
          <b>${VRS.esc((cfg.scoring && cfg.scoring.fastestLap) || 0)}</b> for the fastest
          lap.</p>
          <p>No points for pole. A team that fields no driver is a <b>DNS</b> and scores
          nothing.</p>
        </div>

        <div class="card">
          <h2>Calendar and rhythm</h2>
          <p>Races run in blocks of two with a <b>free week</b> between them. The free week
          is also the <b>transfer window</b> — the only time a driver may change teams.</p>
          <p>Dates are published once the grid is there. The calendar is the track list
          until then, and further rounds may be added.</p>
        </div>

        <div class="card">
          <h2>Stewards</h2>
          <p>Incidents are investigated by the stewards, and every penalty is published in
          the FIA channel and on this site — nothing is decided in private.</p>
          <p>Decisions appear on the <a href="races.html">race centre</a> and on the
          <a href="news.html">news page</a>.</p>
        </div>

        <div class="card">
          <h2>Signing up</h2>
          <p>Pick a team, pick a seat, post in <code>#signings</code>. Open seats are on the
          <a href="seats.html">seat board</a> — every team, every seat, and who already
          holds it.</p>
        </div>
      </div>`;
  } catch (error) {
    VRS.fail(host, error);
  }
})();
