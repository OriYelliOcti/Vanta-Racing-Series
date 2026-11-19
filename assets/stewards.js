/* FIA stewarding desk.
 *
 * Kept out of the navigation: the page opens from #vrs-FIA and asks for the FIA
 * password or a GitHub token. Publishing goes to the bridge on the steward's
 * laptop, which owns the Git credential — the browser never asks for a login.
 */
(async () => {
  const host = document.getElementById("app");
  try {
    const cfg = await VRS.json("data/config.json");
    VRS.shell(cfg, "stewards.html");

    const STORE = "vrs.desk.v1";
    const BRIDGE = ((cfg.bridge && cfg.bridge.defaultUrl) || "http://127.0.0.1:8787").replace(
      /\/$/,
      ""
    );
    const decisions = await VRS.json("data/decisions.json");
    const results = await VRS.json("data/results.json");
    const lineups = await VRS.json("data/lineups.json");
    const schedule = await VRS.json("data/schedule.json");
    const rounds = (schedule.rounds || []).slice().sort((a, b) => a.round - b.round);
    const divisions = cfg.divisions || ["F1", "F2"];

    let session = load();
    let mode = "decision";
    let rows = [];

    function load() {
      try {
        return JSON.parse(sessionStorage.getItem(STORE) || "null") || {};
      } catch {
        return {};
      }
    }

    async function call(path, body) {
      const response = await fetch(BRIDGE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const text = await response.text();
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      if (!response.ok) {
        const message =
          typeof data === "string" ? data : data.problem || JSON.stringify(data);
        const error = new Error(String(message).slice(0, 240));
        error.status = response.status;
        throw error;
      }
      return data;
    }

    /* ---------- locked view ---------- */

    function lockScreen(box = "") {
      host.innerHTML = `
        <h1>FIA stewarding</h1>
        <p class="lead">This desk is kept out of the navigation on purpose. It is
        the extra door: unlock it, enter a result or a decision, and the bridge on
        the steward laptop commits and pushes it. No GitHub login needed.</p>
        <div class="card" style="max-width:440px">
          <label class="field"><span>Password or GitHub token</span>
            <input id="password" type="password" autocomplete="off"
              placeholder="FIA password"></label>
          <div class="row"><button class="primary" id="enter">Unlock desk</button></div>
          <div id="lockState" style="margin-top:12px">${box}</div>
          <p class="small muted" style="margin:12px 0 0">Both the FIA password and the
          league's GitHub token open the desk.</p>
        </div>`;
      const input = document.getElementById("password");
      input.focus();
      const submit = async () => {
        const password = input.value.trim();
        const out = document.getElementById("lockState");
        if (!password) {
          out.innerHTML = `<div class="err">Enter the password or token.</div>`;
          return;
        }
        out.innerHTML = `<div class="warn">Checking the desk…</div>`;
        try {
          const answer = await call("/unlock", { password });
          session = { password, owner: answer.owner || "FIA Steward" };
          sessionStorage.setItem(STORE, JSON.stringify(session));
          renderDesk();
        } catch (error) {
          out.innerHTML =
            error.status === 401
              ? `<div class="err"><b>Wrong password or token.</b> Try again.</div>`
              : `<div class="err"><b>Desk unreachable.</b> ${VRS.esc(error.message)}<br>
                 <span class="small">The bridge must run on the steward laptop:
                 <code>python tools/desk_server.py</code></span></div>`;
        }
      };
      document.getElementById("enter").addEventListener("click", submit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") submit();
      });
    }

    /* ---------- shared ---------- */

    const state = (id, message, kind = "ok") => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = message ? `<div class="${kind}">${message}</div>` : "";
    };

    function teamsOf(division) {
      return (lineups.teams || []).filter((team) => team.division === division);
    }

    function lineupRows(division) {
      const out = [];
      for (const team of teamsOf(division)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))) {
        for (const member of ((team.slots || {}).driver || {}).members || []) {
          out.push({
            driver: member.name,
            team: team.key,
            fastestLap: false,
            pole: false,
            note: "",
          });
        }
      }
      return out;
    }

    function savedRows(number, division) {
      const round = (results.rounds || []).find((r) => Number(r.round) === Number(number));
      const saved = round && round.divisions ? round.divisions[division] : null;
      return Array.isArray(saved) && saved.length ? saved.map((r) => ({ ...r })) : null;
    }

    function mergeResult(result) {
      let round = (results.rounds || []).find(
        (r) => Number(r.round) === Number(result.round)
      );
      if (!round) {
        round = { round: result.round, name: result.name, divisions: {} };
        results.rounds.push(round);
      }
      round.name = result.name;
      round.divisions = round.divisions || {};
      round.divisions[result.division] = result.rows;
      results.rounds.sort((a, b) => Number(a.round) - Number(b.round));
    }

    /* ---------- lists ---------- */

    function renderList() {
      const list = (decisions.decisions || []).slice().reverse();
      document.getElementById("list").innerHTML = list.length
        ? `<div class="card"><ul class="list">${list
            .map(
              (d) => `<li>
                <div class="spread">
                  <div><span class="chip">R${VRS.esc(d.round)}</span>
                    <b style="margin-left:6px">${VRS.esc(d.subject || "—")}</b>
                    <span class="small muted"> · ${VRS.esc(d.type || "")}</span></div>
                  <span class="small muted">${VRS.esc(d.by || "")} · ${VRS.esc(
                    d.publishedAt ? new Date(d.publishedAt).toLocaleString() : ""
                  )}</span>
                </div>
                <div style="margin-top:4px">${VRS.esc(d.text || "")}</div>
                ${
                  d.clip
                    ? `<a class="small" href="${VRS.esc(d.clip)}" target="_blank" rel="noopener">clip</a>`
                    : ""
                }
              </li>`
            )
            .join("")}</ul></div>`
        : `<div class="card muted">Nothing published yet.</div>`;
    }

    function renderResults() {
      const list = (results.rounds || []).filter(
        (r) => r.divisions && Object.keys(r.divisions).length
      );
      document.getElementById("resultsList").innerHTML = list.length
        ? `<div class="card"><table>
            <thead><tr><th class="pos">R</th><th>Round</th>${divisions
              .map((d) => `<th>${VRS.esc(d)}</th>`)
              .join("")}</tr></thead>
            <tbody>${list
              .map((r) => {
                const cells = divisions
                  .map((d) => {
                    const list_ = (r.divisions || {})[d];
                    return `<td class="muted">${
                      list_ && list_.length
                        ? `${list_.length} drivers · ${VRS.esc(
                            (list_.slice().sort((a, b) => a.pos - b.pos)[0] || {}).driver || "—"
                          )}`
                        : "—"
                    }</td>`;
                  })
                  .join("");
                return `<tr><td class="pos">${VRS.esc(r.round)}</td>
                  <td><b>${VRS.esc(r.name || "")}</b></td>${cells}</tr>`;
              })
              .join("")}</tbody></table></div>`
        : `<div class="card muted">No results published yet.</div>`;
    }

    function renderAudit() {
      const rows_ = (decisions.audit || []).slice().reverse();
      document.getElementById("audit").innerHTML = rows_.length
        ? `<div class="card"><table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>${rows_
              .map(
                (a) => `<tr><td class="muted">${VRS.esc(
                  a.at ? new Date(a.at).toLocaleString() : ""
                )}</td><td><b>${VRS.esc(a.actor || "—")}</b></td>
                <td>${VRS.esc(a.action || "")}</td>
                <td class="muted">${VRS.esc(a.target || "")}</td></tr>`
              )
              .join("")}</tbody></table></div>`
        : `<div class="card muted">No audit entries yet.</div>`;
    }

    /* ---------- decision pane ---------- */

    function renderDecisionPane() {
      document.getElementById("pane").innerHTML = `
        <div class="card">
          <h2 style="margin-top:0">Publish a decision</h2>
          <div class="grid2">
            <label class="field"><span>Round</span>
              <select id="round">
                ${rounds
                  .map(
                    (r) =>
                      `<option value="${r.round}">R${r.round} · ${VRS.esc(
                        r.circuit || ""
                      )}</option>`
                  )
                  .join("")}
              </select></label>
            <label class="field"><span>Type</span>
              <select id="type">
                <option value="decision">Decision</option>
                <option value="penalty">Penalty</option>
                <option value="investigation">Investigation</option>
                <option value="clip">Clip</option>
              </select></label>
          </div>
          <label class="field"><span>Subject</span>
            <input id="subject" placeholder="Driver, team or incident"></label>
          <label class="field"><span>Ruling</span>
            <textarea id="text" placeholder="What the stewards decided and why"></textarea></label>
          <label class="field"><span>Clip URL (optional)</span>
            <input id="clip" placeholder="https://..."></label>
          <div class="row">
            <button class="primary" id="publish">Publish</button>
            <button id="preview">Preview JSON</button>
          </div>
          <div id="publishState" style="margin-top:12px"></div>
        </div>`;

      const entryOf = () => ({
        round: Number(document.getElementById("round").value || 0),
        type: document.getElementById("type").value,
        subject: document.getElementById("subject").value.trim(),
        text: document.getElementById("text").value.trim(),
        clip: document.getElementById("clip").value.trim(),
      });

      document.getElementById("preview").addEventListener("click", () => {
        state(
          "publishState",
          `<pre class="small" style="white-space:pre-wrap">${VRS.esc(
            JSON.stringify(entryOf(), null, 2)
          )}</pre>`
        );
      });

      document.getElementById("publish").addEventListener("click", async () => {
        const payload = entryOf();
        if (!payload.text) {
          state("publishState", "Write the ruling first.", "err");
          return;
        }
        state("publishState", "Publishing — committing and pushing…", "warn");
        try {
          const answer = await call("/publish", {
            password: session.password,
            kind: "decision",
            entry: payload,
          });
          state(
            "publishState",
            `<b>Published.</b> ${commitNote(answer)}logged as ${VRS.esc(
              answer.owner || session.owner
            )}.`,
            "ok"
          );
          document.getElementById("subject").value = "";
          document.getElementById("text").value = "";
          document.getElementById("clip").value = "";
          if (answer.decision) decisions.decisions.push(answer.decision);
          if (answer.audit) decisions.audit.push(answer.audit);
          renderList();
          renderAudit();
        } catch (error) {
          state(
            "publishState",
            `<b>Not published.</b> ${VRS.esc(error.message)}<br>
            <span class="small">The repository is untouched.</span>`,
            "err"
          );
          if (error.status === 401) lockScreen(`<div class="err">Session lost — unlock again.</div>`);
        }
      });
    }

    /* ---------- result pane ---------- */

    function renderResultPane() {
      document.getElementById("pane").innerHTML = `
        <div class="card">
          <h2 style="margin-top:0">Publish a race result</h2>
          <p class="small muted" style="margin-top:0">Row order is the finishing order.
          Publishing replaces that round's result for the chosen division, and the
          championship, home page and fantasy all follow from it.</p>

          <div class="row" style="margin-bottom:10px">
            <label class="field" style="margin:0;min-width:170px"><span>Round</span>
              <select id="rRound">
                ${rounds
                  .map(
                    (r) =>
                      `<option value="${r.round}">R${r.round} · ${VRS.esc(
                        r.circuit || ""
                      )}</option>`
                  )
                  .join("")}
              </select></label>
            <label class="field" style="margin:0;min-width:110px"><span>Division</span>
              <select id="rDivision">
                ${divisions
                  .map((d) => `<option value="${VRS.esc(d)}">${VRS.esc(d)}</option>`)
                  .join("")}
              </select></label>
            <div class="row" style="align-items:flex-end;padding-bottom:9px">
              <button id="rFill">Fill from lineup</button>
              <button id="rAdd">Add row</button>
              <button id="rClear">Clear</button>
            </div>
          </div>

          <div class="rwrap">
            <div class="rhead small muted">
              <span>#</span><span>Driver</span><span>Team</span>
              <span>FL</span><span>Pole</span><span>Note</span><span></span>
            </div>
            <div id="rRows"></div>
          </div>

          <div class="row" style="margin-top:12px">
            <button class="primary" id="rPublish">Publish result</button>
          </div>
          <div id="rState" style="margin-top:12px"></div>
        </div>`;

      const roundSelect = document.getElementById("rRound");
      const divisionSelect = document.getElementById("rDivision");

      rows = savedRows(roundSelect.value, divisionSelect.value) || lineupRows(divisionSelect.value);
      renderRows();
      bindRows();

      const reload = () => {
        rows = savedRows(roundSelect.value, divisionSelect.value) || lineupRows(divisionSelect.value);
        renderRows();
      };
      roundSelect.addEventListener("change", reload);
      divisionSelect.addEventListener("change", reload);
      document.getElementById("rFill").addEventListener("click", () => {
        rows = lineupRows(divisionSelect.value);
        renderRows();
      });
      document.getElementById("rAdd").addEventListener("click", () => {
        rows.push({ driver: "", team: "", fastestLap: false, pole: false, note: "" });
        renderRows();
      });
      document.getElementById("rClear").addEventListener("click", () => {
        rows = [];
        renderRows();
      });
      document.getElementById("rPublish").addEventListener("click", () =>
        publishResult(roundSelect.value, divisionSelect.value)
      );
    }

    function renderRows() {
      const division = document.getElementById("rDivision").value;
      const teams = teamsOf(division);
      const listId = `drivers-${division}`;
      const datalist = `<datalist id="${VRS.esc(listId)}">${teams
        .flatMap((team) => ((team.slots || {}).driver || {}).members || [])
        .map((member) => `<option value="${VRS.esc(member.name)}"></option>`)
        .join("")}</datalist>`;

      document.getElementById("rRows").innerHTML = `${datalist}${rows
        .map(
          (row, index) => `<div class="rrow" data-row="${index}">
            <div class="rpos">${index + 1}</div>
            <input class="rdriver" list="${VRS.esc(listId)}" value="${VRS.esc(
              row.driver || ""
            )}" placeholder="Driver">
            <select class="rteam">
              <option value="">—</option>
              ${teams
                .map(
                  (team) =>
                    `<option value="${VRS.esc(team.key)}" ${
                      team.key === row.team ? "selected" : ""
                    }>${VRS.esc(team.name)}</option>`
                )
                .join("")}
            </select>
            <label class="rflag"><input type="checkbox" class="rfl" ${
              row.fastestLap ? "checked" : ""
            }></label>
            <label class="rflag"><input type="checkbox" class="rpole" ${
              row.pole ? "checked" : ""
            }></label>
            <input class="rnote" value="${VRS.esc(row.note || "")}" placeholder="Note">
            <div class="rmove">
              <button class="r" data-move="up" title="Move up" type="button">↑</button>
              <button class="r" data-move="down" title="Move down" type="button">↓</button>
              <button class="r" data-move="del" title="Remove" type="button">×</button>
            </div>
          </div>`
        )
        .join("")}`;
    }

    function bindRows() {
      const box = document.getElementById("rRows");
      const sync = (node) => {
        const index = Number(node.dataset.row);
        if (!rows[index]) return;
        rows[index].driver = node.querySelector(".rdriver").value;
        rows[index].team = node.querySelector(".rteam").value;
        rows[index].fastestLap = node.querySelector(".rfl").checked;
        rows[index].pole = node.querySelector(".rpole").checked;
        rows[index].note = node.querySelector(".rnote").value;
      };

      box.addEventListener("input", (event) => {
        const node = event.target.closest(".rrow");
        if (node) sync(node);
      });

      box.addEventListener("change", (event) => {
        const node = event.target.closest(".rrow");
        if (!node) return;
        const index = Number(node.dataset.row);
        sync(node);
        if (event.target.classList.contains("rfl") && event.target.checked) {
          rows.forEach((row, i) => {
            if (i !== index) row.fastestLap = false;
          });
          box.querySelectorAll(".rfl").forEach((input, i) => {
            input.checked = i === index;
          });
        }
        if (event.target.classList.contains("rpole") && event.target.checked) {
          rows.forEach((row, i) => {
            if (i !== index) row.pole = false;
          });
          box.querySelectorAll(".rpole").forEach((input, i) => {
            input.checked = i === index;
          });
        }
      });

      box.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-move]");
        if (!button) return;
        const index = Number(button.closest(".rrow").dataset.row);
        const action = button.dataset.move;
        if (action === "up" && index > 0) {
          [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
        } else if (action === "down" && index < rows.length - 1) {
          [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
        } else if (action === "del") {
          rows.splice(index, 1);
        }
        renderRows();
      });
    }

    async function publishResult(round, division) {
      const picked = rows
        .map((row) => ({
          ...row,
          driver: (row.driver || "").trim(),
          team: row.team || "",
          note: (row.note || "").trim(),
        }))
        .filter((row) => row.driver);
      if (!picked.length) {
        state("rState", "Add at least one driver.", "err");
        return;
      }
      const missing = picked.find((row) => !row.team);
      if (missing) {
        state("rState", `Pick a team for ${VRS.esc(missing.driver)}.`, "err");
        return;
      }
      const payload = picked.map((row, index) => ({
        pos: index + 1,
        driver: row.driver,
        team: row.team,
        fastestLap: !!row.fastestLap,
        pole: !!row.pole,
        note: row.note,
      }));

      state("rState", "Publishing — committing and pushing…", "warn");
      try {
        const answer = await call("/publish", {
          password: session.password,
          kind: "result",
          entry: { round: Number(round), division, rows: payload },
        });
        state(
          "rState",
          `<b>Published.</b> ${commitNote(answer)}R${VRS.esc(
            answer.result.round
          )} ${VRS.esc(answer.result.division)} · ${answer.result.rows.length} drivers · ${VRS.esc(
            answer.result.name
          )}.`,
          "ok"
        );
        mergeResult(answer.result);
        if (answer.audit) decisions.audit.push(answer.audit);
        renderResults();
        renderAudit();
      } catch (error) {
        state(
          "rState",
          `<b>Not published.</b> ${VRS.esc(error.message)}<br>
          <span class="small">The repository is untouched.</span>`,
          "err"
        );
        if (error.status === 401) lockScreen(`<div class="err">Session lost — unlock again.</div>`);
      }
    }

    function commitNote(answer) {
      if (answer.commit && answer.commit !== "dry-run") {
        return `Commit <code>${VRS.esc(String(answer.commit).slice(0, 7))}</code> · `;
      }
      if (answer.commit === "dry-run") return "Dry run — nothing was pushed. · ";
      return "";
    }

    /* ---------- desk ---------- */

    function renderDesk() {
      host.innerHTML = `
        <div class="spread">
          <div>
            <h1 style="margin-bottom:4px">FIA stewarding</h1>
            <p class="lead" style="margin-bottom:0">Signed in as
            <b>${VRS.esc(session.owner || "FIA Steward")}</b>. Publishing commits and
            pushes to <code>main</code>; Pages is live about a minute later.</p>
          </div>
          <div class="row">
            <button id="reload">Reload data</button>
            <button id="signOut">Lock desk</button>
          </div>
        </div>

        <div class="tabs" id="modeTabs" style="margin-top:16px">
          <button data-mode="decision" class="${mode === "decision" ? "on" : ""}">Steward decision</button>
          <button data-mode="result" class="${mode === "result" ? "on" : ""}">Race result</button>
        </div>
        <div id="pane"></div>

        <h2>Published results</h2>
        <div id="resultsList"></div>

        <h2>Published decisions</h2>
        <div id="list"></div>

        <h2>Audit log</h2>
        <div id="audit"></div>`;

      document.getElementById("signOut").addEventListener("click", () => {
        sessionStorage.removeItem(STORE);
        session = {};
        lockScreen(`<div class="ok">Desk locked.</div>`);
      });
      document.getElementById("reload").addEventListener("click", () => location.reload());
      document.getElementById("modeTabs").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-mode]");
        if (!button) return;
        mode = button.dataset.mode;
        [...document.querySelectorAll("#modeTabs button")].forEach((b) =>
          b.classList.toggle("on", b === button)
        );
        if (mode === "decision") renderDecisionPane();
        else renderResultPane();
      });

      if (mode === "decision") renderDecisionPane();
      else renderResultPane();
      renderList();
      renderResults();
      renderAudit();
    }

    if (session.password) {
      // Re-check the saved secret so a stale session never looks signed in.
      call("/unlock", { password: session.password })
        .then((answer) => {
          session.owner = answer.owner || session.owner;
          renderDesk();
        })
        .catch((error) => {
          sessionStorage.removeItem(STORE);
          session = {};
          lockScreen(
            error.status === 401
              ? `<div class="err">The saved password or token is no longer valid.</div>`
              : `<div class="warn">Desk not reachable right now.</div>`
          );
        });
    } else {
      lockScreen();
    }
  } catch (error) {
    VRS.fail(host, error);
  }
})();
