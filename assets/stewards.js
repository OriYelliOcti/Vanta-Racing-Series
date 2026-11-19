/* FIA stewarding desk.
 *
 * Kept out of the navigation: the page opens from #vrs-FIA and asks for the FIA
 * access password. Publishing goes to the bridge on the steward's laptop, which
 * owns the Git credential — the browser never sees or asks for a token.
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
    const schedule = await VRS.json("data/schedule.json");
    const rounds = (schedule.rounds || []).slice().sort((a, b) => a.round - b.round);

    const load = () => {
      try {
        return JSON.parse(sessionStorage.getItem(STORE) || "null") || {};
      } catch {
        return {};
      }
    };
    let session = load();

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
        const error = new Error(String(message).slice(0, 220));
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
        the extra door: enter the FIA access password, and publish decisions with
        one click. No token, no GitHub login — the bridge on the steward laptop
        commits and pushes for you.</p>
        <div class="card" style="max-width:420px">
          <label class="field"><span>Access password</span>
            <input id="password" type="password" autocomplete="current-password"
              placeholder="FIA password"></label>
          <div class="row"><button class="primary" id="enter">Unlock desk</button></div>
          <div id="lockState" style="margin-top:12px">${box}</div>
        </div>`;
      const input = document.getElementById("password");
      input.focus();
      const submit = async () => {
        const password = input.value.trim();
        const out = document.getElementById("lockState");
        if (!password) {
          out.innerHTML = `<div class="err">Enter the FIA password.</div>`;
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
              ? `<div class="err"><b>Wrong password.</b> Try again.</div>`
              : `<div class="err"><b>Desk unreachable.</b> ${VRS.esc(error.message)}<br>
                 <span class="small">Start the bridge on the steward laptop:
                 <code>python tools/desk_server.py</code></span></div>`;
        }
      };
      document.getElementById("enter").addEventListener("click", submit);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") submit();
      });
    }

    /* ---------- desk view ---------- */

    const state = (id, message, kind = "ok") => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = message ? `<div class="${kind}">${message}</div>` : "";
    };

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

    function renderAudit() {
      const rows = (decisions.audit || []).slice().reverse();
      document.getElementById("audit").innerHTML = rows.length
        ? `<div class="card"><table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
            <tbody>${rows
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

    function entry() {
      return {
        round: Number(document.getElementById("round").value || 0),
        type: document.getElementById("type").value,
        subject: document.getElementById("subject").value.trim(),
        text: document.getElementById("text").value.trim(),
        clip: document.getElementById("clip").value.trim(),
      };
    }

    function renderDesk() {
      host.innerHTML = `
        <div class="spread">
          <div>
            <h1 style="margin-bottom:4px">FIA stewarding</h1>
            <p class="lead" style="margin-bottom:0">Signed in as
            <b>${VRS.esc(session.owner || "FIA Steward")}</b>. Publishing commits
            the decision and pushes to <code>main</code>; Pages is live about a
            minute later.</p>
          </div>
          <button id="signOut">Lock desk</button>
        </div>

        <div class="grid2" style="margin-top:16px">
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
          </div>

          <div class="card">
            <h2 style="margin-top:0">Desk</h2>
            <p class="small muted" style="margin-top:0">Bridge
            <code>${VRS.esc(BRIDGE)}</code> on this laptop. Every publish lands in
            <code>data/decisions.json</code> and in the audit log below.</p>
            <div class="row">
              <button id="export">Download decisions.json</button>
              <button id="reload">Reload data</button>
            </div>
            <p class="small muted" style="margin-top:12px">This page never sees a
            GitHub token. If the bridge is stopped, publishing stops; the site
            itself keeps running.</p>
          </div>
        </div>

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

      document.getElementById("preview").addEventListener("click", () => {
        state(
          "publishState",
          `<pre class="small" style="white-space:pre-wrap">${VRS.esc(
            JSON.stringify(entry(), null, 2)
          )}</pre>`
        );
      });

      document.getElementById("publish").addEventListener("click", async () => {
        const payload = entry();
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
            `<b>Published.</b> ${
              answer.commit && answer.commit !== "dry-run"
                ? `Commit <code>${VRS.esc(String(answer.commit).slice(0, 7))}</code> · `
                : answer.commit === "dry-run"
                  ? "Dry run — nothing was pushed. · "
                  : ""
            }logged as ${VRS.esc(answer.owner || session.owner)}.`,
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
          if (error.status === 401) lockScreen(`<div class="err">Session expired — enter the password again.</div>`);
        }
      });

      document.getElementById("export").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(decisions, null, 2)], {
          type: "application/json",
        });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "decisions.json";
        link.click();
      });

      renderList();
      renderAudit();
    }

    if (session.password) {
      // Re-check the saved password so a stale session never looks signed in.
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
              ? `<div class="err">The saved password is no longer valid.</div>`
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
