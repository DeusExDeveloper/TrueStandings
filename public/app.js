/*
 * WSS Standings — app shell.
 *
 * Loads the league from the Netlify Function (Blobs-backed) and saves it back
 * with a password-gated POST. The edit password is NEVER stored in this code or
 * checked here — it is held only in sessionStorage for the current tab while
 * unlocked, sent as a header, and verified server-side.
 *
 * Depends on:
 *   - WSS                    (scoring.js) pure scoring functions
 *   - WSS_PLACEHOLDER_LEAGUE (data.js)    fallback seed for local file preview
 */
(function () {
  "use strict";

  // --- backend / state -------------------------------------------------------

  const API = "/.netlify/functions/standings";
  const PW_KEY = "wss-edit-pw"; // sessionStorage key (this tab only)

  let league = emptyLeague();
  let editMode = false;
  let dirty = false; // unsaved in-memory edits since last load/save
  let backendOk = false; // did the initial fetch succeed?

  function emptyLeague() {
    return {
      title: "World Sim Series",
      teams: [],
      drivers: [],
      races: [],
      results: {},
      penalties: [],
      stages: [],
    };
  }

  // Password is kept only in sessionStorage (per-tab), never in localStorage,
  // never written into the saved league.
  function getPassword() {
    return sessionStorage.getItem(PW_KEY) || "";
  }
  function setPassword(pw) {
    sessionStorage.setItem(PW_KEY, pw);
  }
  function clearPassword() {
    sessionStorage.removeItem(PW_KEY);
  }

  // Mark the in-memory league as edited; refreshes the Save button state.
  function markDirty() {
    dirty = true;
    updateSaveButton();
  }

  // --- small helpers ---------------------------------------------------------

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v != null) {
        node.setAttribute(k, v);
      }
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function resultKey(driverId, raceId) {
    return `${driverId}_${raceId}`;
  }

  function teamById(id) {
    return league.teams.find((t) => t.id === id);
  }

  function posTagText(result) {
    if (!result) return "—";
    if (result.status === "dnf") return "DNF";
    if (result.status === "dsq") return "DSQ";
    if (result.position == null) return "—";
    return `P${result.position}`;
  }

  // --- rendering: entry grid -------------------------------------------------

  function renderGrid() {
    const wrap = $("#grid-view .grid-wrap");
    wrap.innerHTML = "";

    if (league.drivers.length === 0 || league.races.length === 0) {
      wrap.appendChild(
        el("div", {
          class: "empty-state",
          text: "Add at least one team, driver, and race to start entering results.",
        })
      );
      renderWarnings();
      return;
    }

    const table = el("table", { class: "entry-grid" });

    // header
    const thead = el("thead");
    const headRow = el("tr");
    headRow.appendChild(el("th", { text: "Driver" }));
    for (const race of league.races) {
      const kindBadge = el("span", {
        class: `kind ${race.kind === "sprint" ? "sprint" : "race"}`,
        text: race.kind === "sprint" ? "SPR" : "RACE",
      });
      const th = el("th", {}, [document.createTextNode(race.label + " "), kindBadge]);
      if (editMode) {
        th.appendChild(document.createElement("br"));
        th.appendChild(
          el("button", {
            class: "btn small danger",
            text: "remove",
            title: `Remove ${race.label}`,
            onclick: () => removeRace(race.id),
          })
        );
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    // body — drivers grouped by team
    const tbody = el("tbody");
    for (const team of league.teams) {
      const teamDrivers = league.drivers.filter((d) => d.teamId === team.id);
      if (teamDrivers.length === 0 && !editMode) continue;

      // team group header
      const teamRow = el("tr", { class: "team-row" });
      const teamPts = WSS.teamPoints(team.id, league.results, league.drivers, league.races);
      teamRow.appendChild(
        el("td", { colspan: league.races.length + 1 }, [
          el("span", { class: "team-dot", style: `background:${team.color}` }),
          el("span", { class: "team-name", text: team.name }),
          el("span", { class: "team-pts num", text: `${teamPts} pts` }),
        ])
      );
      tbody.appendChild(teamRow);

      for (const driver of teamDrivers) {
        tbody.appendChild(renderDriverRow(driver, team));
      }
    }

    // drivers with no/unknown team (defensive)
    const orphaned = league.drivers.filter((d) => !teamById(d.teamId));
    for (const driver of orphaned) {
      tbody.appendChild(renderDriverRow(driver, { color: "#666", name: "—" }));
    }

    table.appendChild(tbody);
    wrap.appendChild(table);

    renderWarnings();
  }

  function renderDriverRow(driver, team) {
    const tr = el("tr", { class: driver.locked ? "locked" : "" });

    // driver name cell
    const nameCell = el("td", {
      class: "driver-cell",
      style: `border-left-color:${team.color}`,
    });
    nameCell.appendChild(el("span", { class: "num", text: `#${driver.number}` }));
    nameCell.appendChild(el("span", { class: "dname", text: driver.name }));
    if (driver.locked) {
      nameCell.appendChild(el("span", { class: "lock-icon", text: "🔒" }));
      nameCell.appendChild(el("span", { class: "locked-label", text: "locked" }));
    }
    // row tools (edit mode)
    const tools = el("div", { class: "row-tools" });
    tools.appendChild(
      el("button", {
        class: "btn small",
        text: driver.locked ? "Unlock row" : "Lock row",
        onclick: () => toggleLock(driver.id),
      })
    );
    tools.appendChild(
      el("button", {
        class: "btn small danger",
        text: "Remove",
        onclick: () => removeDriver(driver.id),
      })
    );
    nameCell.appendChild(tools);
    tr.appendChild(nameCell);

    // result cells
    for (const race of league.races) {
      tr.appendChild(renderResultCell(driver, race, team));
    }
    return tr;
  }

  function renderResultCell(driver, race, team) {
    const result = WSS.getResult(league.results, driver.id, race.id);
    const readonly = driver.locked;
    const overLimit =
      result &&
      result.teamRace === true &&
      WSS.isTeamRaceOverLimit(driver.teamId, race.id, league.results, league.drivers);

    const td = el("td", {
      class: `result-cell ${readonly ? "readonly" : ""} ${overLimit ? "over-limit" : ""}`,
      title: overLimit
        ? `Warning: ${team.name} has 3+ team-scoring drivers in ${race.label}`
        : "",
    });

    const pts = WSS.pointsForResult(result);
    const tagClass = result && (result.status === "dnf" || result.status === "dsq")
      ? result.status
      : (!result || result.position == null ? "empty" : "");
    td.appendChild(el("span", { class: `pos-tag ${tagClass}`, text: posTagText(result) }));
    td.appendChild(el("span", { class: "cell-pts", text: `${pts} pts` }));

    if (result && result.position != null) {
      td.appendChild(
        el("span", {
          class: `cell-flag ${result.teamRace ? "team" : "indep"}`,
          text: result.teamRace ? "Team" : "Indep",
        })
      );
    }

    if (editMode && !readonly) {
      td.addEventListener("click", () => openCellEditor(driver, race));
    }
    return td;
  }

  function renderWarnings() {
    const banner = $("#warn-banner");
    const warnings = WSS.overLimitTeamRaces(league.results, league.drivers, league.races);
    if (warnings.length === 0 || !editMode) {
      banner.classList.remove("show");
      banner.innerHTML = "";
      return;
    }
    const lines = warnings.map((w) => {
      const t = teamById(w.teamId);
      const r = league.races.find((x) => x.id === w.raceId);
      return `${t ? t.name : w.teamId} — ${r ? r.label : w.raceId}: ${w.count} team-scoring drivers`;
    });
    banner.innerHTML =
      `<span class="icon">⚑</span><strong>Team limit exceeded</strong> ` +
      `(max ${WSS.MAX_TEAM_DRIVERS_PER_RACE} per race). Review the flagged cells — ` +
      `nothing was auto-changed:<br>` +
      lines.map((l) => `&nbsp;&nbsp;• ${l}`).join("<br>");
    banner.classList.add("show");
  }

  // --- cell editor modal -----------------------------------------------------

  function defaultTeamFlagFor(driver, race) {
    // Default the Team/Independent toggle to whatever this driver was set to
    // in their most recent prior race that has an entry.
    const idx = league.races.findIndex((r) => r.id === race.id);
    for (let i = idx - 1; i >= 0; i--) {
      const prev = WSS.getResult(league.results, driver.id, league.races[i].id);
      if (prev && typeof prev.teamRace === "boolean") return prev.teamRace;
    }
    return true; // sensible default: team
  }

  function openCellEditor(driver, race) {
    const existing = WSS.getResult(league.results, driver.id, race.id);
    const state = {
      position: existing && existing.position != null ? existing.position : "",
      status: existing ? existing.status : "finished",
      teamRace: existing ? existing.teamRace : defaultTeamFlagFor(driver, race),
    };

    const posInput = el("input", {
      type: "number",
      min: "1",
      placeholder: "—",
      value: state.position,
    });

    // status segmented control
    const statusSeg = el("div", { class: "seg status" });
    for (const [val, label] of [["finished", "Finished"], ["dnf", "DNF"], ["dsq", "DSQ"]]) {
      statusSeg.appendChild(
        el("button", {
          "data-val": val,
          class: state.status === val ? "active" : "",
          text: label,
          onclick: () => {
            state.status = val;
            $$("button", statusSeg).forEach((b) =>
              b.classList.toggle("active", b.getAttribute("data-val") === val)
            );
            updatePreview();
          },
        })
      );
    }

    // Team / Independent two-state switch — big and obvious.
    const teamSeg = el("div", { class: "seg" });
    function setTeamFlag(val) {
      state.teamRace = val;
      $$("button", teamSeg).forEach((b) =>
        b.classList.toggle("active", b.getAttribute("data-val") === (val ? "team" : "independent"))
      );
    }
    teamSeg.appendChild(
      el("button", {
        "data-val": "team",
        class: state.teamRace ? "active" : "",
        text: "Team",
        onclick: () => setTeamFlag(true),
      })
    );
    teamSeg.appendChild(
      el("button", {
        "data-val": "independent",
        class: !state.teamRace ? "active" : "",
        text: "Independent",
        onclick: () => setTeamFlag(false),
      })
    );

    const preview = el("div", { class: "seg-caption" });
    function updatePreview() {
      const posVal = posInput.value === "" ? null : parseInt(posInput.value, 10);
      const pts = WSS.pointsForResult({ position: posVal, status: state.status });
      preview.textContent = `Scores: ${pts} pts`;
    }
    posInput.addEventListener("input", updatePreview);
    updatePreview();

    const body = el("div", {}, [
      el("div", { class: "field" }, [
        el("label", { text: `${driver.name} — ${race.label}` }),
        posInput,
      ]),
      el("div", { class: "field" }, [
        el("label", { text: "Status" }),
        statusSeg,
      ]),
      el("div", { class: "field" }, [
        el("label", { text: "Scoring for this race" }),
        teamSeg,
        el("div", {
          class: "seg-caption",
          text: "Independent results don't add to the team total.",
        }),
        preview,
      ]),
    ]);

    openModal(`Result · ${posTagText(existing)}`, body, () => {
      const posVal = posInput.value === "" ? null : parseInt(posInput.value, 10);
      const key = resultKey(driver.id, race.id);
      if (posVal == null && state.status === "finished") {
        // empty finished entry = clear the result
        delete league.results[key];
      } else {
        league.results[key] = {
          position: posVal,
          status: state.status,
          teamRace: !!state.teamRace,
        };
      }
      markDirty();
      closeModal();
      renderAll();
    }, { extraButtons: existing ? [
      el("button", {
        class: "btn ghost",
        text: "Clear",
        onclick: () => {
          delete league.results[resultKey(driver.id, race.id)];
          markDirty();
          closeModal();
          renderAll();
        },
      }),
    ] : [] });
  }

  // --- add/remove teams, drivers, races --------------------------------------

  function openAddTeam() {
    const nameInput = el("input", { type: "text", placeholder: "Team name" });
    const colorInput = el("input", { type: "color", value: "#e10600" });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Team name" }), nameInput]),
      el("div", { class: "field" }, [
        el("label", { text: "Row accent color" }),
        colorInput,
      ]),
    ]);
    openModal("Add team", body, () => {
      const name = nameInput.value.trim();
      if (!name) return setModalError("Name is required.");
      league.teams.push({ id: uid("t"), name, color: colorInput.value });
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function openAddDriver() {
    if (league.teams.length === 0) {
      return alert("Add a team first.");
    }
    const nameInput = el("input", { type: "text", placeholder: "Driver name" });
    const numInput = el("input", { type: "number", min: "0", placeholder: "Car #" });
    const teamSelect = el(
      "select",
      {},
      league.teams.map((t) => el("option", { value: t.id, text: t.name }))
    );
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Driver name" }), nameInput]),
      el("div", { class: "row" }, [
        el("div", { class: "field", style: "flex:1" }, [
          el("label", { text: "Team" }),
          teamSelect,
        ]),
        el("div", { class: "field", style: "width:90px" }, [
          el("label", { text: "Car #" }),
          numInput,
        ]),
      ]),
    ]);
    openModal("Add driver", body, () => {
      const name = nameInput.value.trim();
      if (!name) return setModalError("Name is required.");
      league.drivers.push({
        id: uid("d"),
        name,
        teamId: teamSelect.value,
        number: numInput.value === "" ? 0 : parseInt(numInput.value, 10),
        locked: false,
      });
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function openAddRace() {
    const labelInput = el("input", { type: "text", placeholder: "e.g. R4 or R5 Sprint" });
    const kindSelect = el("select", {}, [
      el("option", { value: "race", text: "Race" }),
      el("option", { value: "sprint", text: "Sprint" }),
    ]);
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Label" }), labelInput]),
      el("div", { class: "field" }, [el("label", { text: "Kind" }), kindSelect]),
    ]);
    openModal("Add race", body, () => {
      const label = labelInput.value.trim();
      if (!label) return setModalError("Label is required.");
      league.races.push({ id: uid("r"), label, kind: kindSelect.value });
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function removeRace(raceId) {
    const race = league.races.find((r) => r.id === raceId);
    if (!confirm(`Remove ${race ? race.label : "race"} and all its results?`)) return;
    league.races = league.races.filter((r) => r.id !== raceId);
    for (const key of Object.keys(league.results)) {
      if (key.endsWith(`_${raceId}`)) delete league.results[key];
    }
    markDirty();
    renderAll();
  }

  function removeDriver(driverId) {
    const driver = league.drivers.find((d) => d.id === driverId);
    if (driver && driver.locked) {
      return alert("This driver's row is locked. Unlock it first to remove.");
    }
    if (!confirm(`Remove ${driver ? driver.name : "driver"} and all their results?`)) return;
    league.drivers = league.drivers.filter((d) => d.id !== driverId);
    for (const key of Object.keys(league.results)) {
      if (key.startsWith(`${driverId}_`)) delete league.results[key];
    }
    league.penalties = league.penalties.filter((p) => p.driverId !== driverId);
    markDirty();
    renderAll();
  }

  function toggleLock(driverId) {
    const driver = league.drivers.find((d) => d.id === driverId);
    if (driver) driver.locked = !driver.locked;
    markDirty();
    renderAll();
  }

  // --- shared helpers for boards ---------------------------------------------

  function teamChip(team) {
    return el("span", { class: "chip" }, [
      el("span", {
        class: "chip-dot",
        style: `background:${team ? team.color : "#666"}`,
      }),
      el("span", { class: "chip-label", text: team ? team.name : "—" }),
    ]);
  }

  function podiumClass(i) {
    return i < 3 ? "p" + (i + 1) : "";
  }

  // --- 1. Driver Standings board ---------------------------------------------

  function renderDriverBoard() {
    const tbody = $("#driver-board tbody");
    tbody.innerHTML = "";

    // Sort by points desc, ties broken alphabetically by name.
    const standings = WSS.driverStandings(league.drivers, league.results).sort(
      (a, b) =>
        b.points - a.points ||
        a.driver.name.localeCompare(b.driver.name, undefined, { sensitivity: "base" })
    );

    if (standings.length === 0) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", { colspan: 4, class: "empty-cell", text: "No drivers yet." }),
        ])
      );
      return;
    }

    standings.forEach((entry, i) => {
      const team = teamById(entry.driver.teamId);
      tbody.appendChild(
        el("tr", { class: podiumClass(i) }, [
          el("td", { class: "col-pos num", text: String(i + 1) }),
          el("td", { class: "name-cell", text: entry.driver.name }),
          el("td", {}, [teamChip(team)]),
          el("td", { class: "col-pts num", text: String(entry.points) }),
        ])
      );
    });
  }

  // --- 2. Team Standings board (expandable rows) -----------------------------

  // Tracks which team rows are expanded across re-renders.
  const expandedTeams = new Set();

  function renderTeamBoard() {
    const tbody = $("#team-board tbody");
    tbody.innerHTML = "";

    const standings = WSS.teamStandings(
      league.teams,
      league.results,
      league.drivers,
      league.races
    );

    if (standings.length === 0) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", { colspan: 3, class: "empty-cell", text: "No teams yet." }),
        ])
      );
      return;
    }

    standings.forEach((entry, i) => {
      const team = entry.team;
      const isOpen = expandedTeams.has(team.id);

      const row = el("tr", { class: `team-standing ${podiumClass(i)} ${isOpen ? "open" : ""}` }, [
        el("td", { class: "col-pos num", text: String(i + 1) }),
        el("td", {}, [
          el("span", { class: "twisty", text: isOpen ? "▾" : "▸" }),
          el("span", {
            class: "chip-dot swatch",
            style: `background:${team.color}`,
          }),
          el("span", { class: "name-cell", text: team.name }),
        ]),
        el("td", { class: "col-pts num", text: String(entry.points) }),
      ]);
      row.addEventListener("click", () => {
        if (expandedTeams.has(team.id)) expandedTeams.delete(team.id);
        else expandedTeams.add(team.id);
        renderTeamBoard();
      });
      tbody.appendChild(row);

      if (isOpen) tbody.appendChild(renderTeamBreakdownRow(team));
    });
  }

  // Expanded detail: for each race, which drivers scored for the team
  // (teamRace:true) and how much.
  function renderTeamBreakdownRow(team) {
    const detail = el("td", { colspan: 3, class: "breakdown" });

    for (const race of league.races) {
      const scorers = league.drivers
        .filter((d) => d.teamId === team.id)
        .map((d) => ({ d, r: WSS.getResult(league.results, d.id, race.id) }))
        .filter((x) => x.r && x.r.teamRace === true)
        .map((x) => ({
          name: x.d.name,
          pts: WSS.pointsForResult(x.r),
        }));

      const raceTotal = scorers.reduce((s, x) => s + x.pts, 0);
      const line = el("div", { class: "breakdown-line" });
      line.appendChild(el("span", { class: "bd-race", text: race.label }));
      if (scorers.length === 0) {
        line.appendChild(el("span", { class: "bd-empty", text: "— no team scorers" }));
      } else {
        const names = scorers
          .map((s) => `${s.name} (${s.pts})`)
          .join("  ·  ");
        line.appendChild(el("span", { class: "bd-drivers", text: names }));
        line.appendChild(el("span", { class: "bd-total num", text: `${raceTotal} pts` }));
      }
      detail.appendChild(line);
    }

    return el("tr", { class: "breakdown-row" }, [detail]);
  }

  // --- Stage Top 3 cards (manual entry) --------------------------------------

  function renderStageCards() {
    const host = $("#stage-cards");
    host.innerHTML = "";
    const stages = league.stages || [];

    for (const stage of stages) {
      const card = el("div", { class: "stage-card" });
      card.appendChild(el("div", { class: "stage-title", text: stage.label }));

      (stage.rows || []).forEach((rowData, idx) => {
        const medalClass = idx < 3 ? "p" + (idx + 1) : "";
        const row = el("div", { class: `stage-row ${medalClass}` });
        row.appendChild(el("span", { class: "stage-rank num", text: String(idx + 1) }));

        if (editMode) {
          const nameInput = el("input", {
            type: "text",
            class: "stage-input",
            placeholder: "Driver",
            value: rowData.name || "",
          });
          const ptsInput = el("input", {
            type: "number",
            class: "stage-input stage-pts num",
            placeholder: "0",
            value: rowData.points === "" || rowData.points == null ? "" : rowData.points,
          });
          nameInput.addEventListener("input", () => {
            rowData.name = nameInput.value;
            markDirty();
          });
          ptsInput.addEventListener("input", () => {
            rowData.points = ptsInput.value === "" ? "" : parseInt(ptsInput.value, 10);
            markDirty();
          });
          row.appendChild(nameInput);
          row.appendChild(ptsInput);
        } else {
          row.appendChild(
            el("span", { class: "stage-name", text: rowData.name || "—" })
          );
          row.appendChild(
            el("span", {
              class: "stage-pts num",
              text:
                rowData.points === "" || rowData.points == null
                  ? "—"
                  : String(rowData.points),
            })
          );
        }
        card.appendChild(row);
      });

      host.appendChild(card);
    }
  }

  // --- 3. Penalties board (manual entry) -------------------------------------

  const BAN_FIELDS = [
    ["qualiBan", "Quali Ban"],
    ["qualiBan2", "Quali Ban 2"],
    ["raceBan", "Race Ban"],
    ["seasonBan", "Season Ban"],
  ];

  function renderPenaltyBoard() {
    const tbody = $("#penalty-board tbody");
    tbody.innerHTML = "";

    const penalties = league.penalties || [];
    if (penalties.length === 0) {
      tbody.appendChild(
        el("tr", {}, [
          el("td", {
            colspan: editMode ? 8 : 7,
            class: "empty-cell",
            text: "No penalties recorded.",
          }),
        ])
      );
      return;
    }

    for (const pen of penalties) {
      const driver = league.drivers.find((d) => d.id === pen.driverId);
      const tr = el("tr");

      // Driver
      tr.appendChild(el("td", { class: "name-cell", text: driver ? driver.name : "—" }));

      // Penalty points
      tr.appendChild(el("td", { class: "col-pts num", text: String(pen.points || 0) }));

      // Four ban toggle cells
      for (const [field] of BAN_FIELDS) {
        const active = !!pen[field];
        const td = el("td", {
          class: `col-ban ban-cell ${active ? "on" : ""} ${editMode ? "clickable" : ""}`,
          text: active ? "✕" : "",
          title: editMode ? "Toggle" : "",
        });
        if (editMode) {
          td.addEventListener("click", () => {
            pen[field] = !pen[field];
            markDirty();
            renderPenaltyBoard();
          });
        }
        tr.appendChild(td);
      }

      // Note
      tr.appendChild(el("td", { class: "note-cell", text: pen.note || "" }));

      // Actions (edit mode)
      if (editMode) {
        const actCell = el("td", { class: "col-act" });
        actCell.appendChild(
          el("button", {
            class: "btn small",
            text: "Edit",
            onclick: () => openEditPenalty(pen),
          })
        );
        actCell.appendChild(
          el("button", {
            class: "btn small danger",
            text: "Remove",
            onclick: () => removePenalty(pen.id),
          })
        );
        tr.appendChild(actCell);
      }

      tbody.appendChild(tr);
    }
  }

  function openEditPenalty(existing) {
    const isNew = !existing;
    const pen = existing || {
      id: uid("p"),
      driverId: league.drivers[0] ? league.drivers[0].id : "",
      points: 0,
      qualiBan: false,
      qualiBan2: false,
      raceBan: false,
      seasonBan: false,
      note: "",
    };

    if (league.drivers.length === 0) {
      return alert("Add a driver first.");
    }

    const driverSelect = el(
      "select",
      {},
      league.drivers.map((d) =>
        el("option", {
          value: d.id,
          text: d.name,
          ...(d.id === pen.driverId ? { selected: "selected" } : {}),
        })
      )
    );
    const ptsInput = el("input", { type: "number", value: String(pen.points || 0) });
    const noteInput = el("input", { type: "text", value: pen.note || "", placeholder: "Context" });

    // Ban toggles as checkboxes in the form
    const banWrap = el("div", { class: "ban-toggle-wrap" });
    const banInputs = {};
    for (const [field, label] of BAN_FIELDS) {
      const cb = el("input", { type: "checkbox", ...(pen[field] ? { checked: "checked" } : {}) });
      banInputs[field] = cb;
      banWrap.appendChild(el("label", { class: "ban-toggle" }, [cb, document.createTextNode(" " + label)]));
    }

    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Driver" }), driverSelect]),
      el("div", { class: "field" }, [el("label", { text: "Penalty points" }), ptsInput]),
      el("div", { class: "field" }, [el("label", { text: "Bans" }), banWrap]),
      el("div", { class: "field" }, [el("label", { text: "Note" }), noteInput]),
    ]);

    openModal(isNew ? "Add penalty entry" : "Edit penalty", body, () => {
      pen.driverId = driverSelect.value;
      pen.points = ptsInput.value === "" ? 0 : parseInt(ptsInput.value, 10);
      pen.note = noteInput.value;
      for (const [field] of BAN_FIELDS) pen[field] = banInputs[field].checked;
      if (isNew) league.penalties.push(pen);
      markDirty();
      closeModal();
      renderAll();
    });
  }

  function removePenalty(penId) {
    if (!confirm("Remove this penalty entry?")) return;
    league.penalties = league.penalties.filter((p) => p.id !== penId);
    markDirty();
    renderAll();
  }

  // --- modal plumbing --------------------------------------------------------

  let onConfirm = null;

  function openModal(title, bodyNode, confirmFn, opts = {}) {
    $("#modal-title").textContent = title;
    const body = $("#modal-body");
    body.innerHTML = "";
    body.appendChild(bodyNode);
    setModalError("");
    onConfirm = confirmFn;

    const actions = $("#modal-actions");
    actions.innerHTML = "";
    (opts.extraButtons || []).forEach((b) => actions.appendChild(b));
    actions.appendChild(
      el("button", { class: "btn ghost", text: "Cancel", onclick: closeModal })
    );
    actions.appendChild(
      el("button", { class: "btn primary", text: "Save", onclick: () => onConfirm && onConfirm() })
    );

    $("#modal-backdrop").classList.add("show");
  }

  function closeModal() {
    $("#modal-backdrop").classList.remove("show");
    onConfirm = null;
  }

  function setModalError(msg) {
    $("#modal-err").textContent = msg || "";
  }

  // --- backend: load + save --------------------------------------------------

  async function loadLeague() {
    try {
      const res = await fetch(API, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      league = normalizeLeague(data.league);
      backendOk = true;
      dirty = false;
      hideBanner();
    } catch (err) {
      // Almost always: opened as a local file, or the function isn't deployed.
      backendOk = false;
      league = normalizeLeague(window.WSS_PLACEHOLDER_LEAGUE);
      showOfflineBanner();
    }
    renderAll();
    updateSaveButton();
  }

  // Ensure every expected field exists so the UI never trips on a partial
  // payload (e.g. an older save without `stages`).
  function normalizeLeague(raw) {
    const base = emptyLeague();
    if (!raw || typeof raw !== "object") return base;
    return {
      title: typeof raw.title === "string" ? raw.title : base.title,
      teams: Array.isArray(raw.teams) ? raw.teams : [],
      drivers: Array.isArray(raw.drivers) ? raw.drivers : [],
      races: Array.isArray(raw.races) ? raw.races : [],
      results: raw.results && typeof raw.results === "object" ? raw.results : {},
      penalties: Array.isArray(raw.penalties) ? raw.penalties : [],
      stages: Array.isArray(raw.stages) ? raw.stages : [],
    };
  }

  let saving = false;

  async function saveChanges() {
    if (!editMode || saving || !dirty) return;
    const pw = getPassword();
    if (!pw) {
      // Lost the session password somehow — force re-unlock.
      setSaveStatus("error", "Session expired — unlock again.");
      exitEditMode();
      return;
    }
    saving = true;
    setSaveStatus("saving", "Saving…");
    updateSaveButton();
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-edit-password": pw,
        },
        body: JSON.stringify(league),
      });
      if (res.status === 401) {
        setSaveStatus("error", "Password rejected — unlock again.");
        exitEditMode();
        return;
      }
      if (!res.ok) {
        let msg = `Save failed (HTTP ${res.status}).`;
        try {
          const e = await res.json();
          if (e && e.error) msg = e.error;
        } catch {}
        setSaveStatus("error", msg);
        return;
      }
      dirty = false;
      setSaveStatus("ok", "Saved ✓");
    } catch (err) {
      setSaveStatus("error", "Network error — not saved.");
    } finally {
      saving = false;
      updateSaveButton();
    }
  }

  function setSaveStatus(kind, msg) {
    const node = $("#save-status");
    node.textContent = msg || "";
    node.className = "save-status " + (kind || "");
  }

  function updateSaveButton() {
    const btn = $("#btn-save");
    if (!btn) return;
    const canSave = editMode && dirty && !saving && backendOk;
    btn.disabled = !canSave;
    btn.style.display = editMode ? "" : "none";
  }

  // --- offline / error banner ------------------------------------------------

  function showOfflineBanner() {
    const b = $("#offline-banner");
    b.innerHTML =
      '<span class="icon">⚠</span><strong>Live data unavailable.</strong> ' +
      "This board reads and saves through a Netlify Function, which only runs " +
      "on the deployed site. Opening <code>index.html</code> directly shows " +
      "placeholder data and cannot save. Deploy to Netlify to use it for real.";
    b.classList.add("show");
  }
  function hideBanner() {
    $("#offline-banner").classList.remove("show");
  }

  // --- password / mode toggle ------------------------------------------------

  function enterEditMode() {
    const pwInput = el("input", { type: "password", placeholder: "Edit password" });
    const body = el("div", {}, [
      el("div", { class: "field" }, [el("label", { text: "Password" }), pwInput]),
      el("div", {
        class: "hint",
        text: "The password is verified on the server and kept only for this browser tab.",
      }),
    ]);
    openModal("Unlock editing", body, async () => {
      const pw = pwInput.value;
      if (!pw) return setModalError("Enter the edit password.");
      if (!backendOk) {
        return setModalError("Editing needs the live site — deploy to Netlify first.");
      }
      setModalError("Checking…");
      try {
        const res = await fetch(`${API}?check=1`, {
          headers: { "x-edit-password": pw },
        });
        if (res.status === 200) {
          setPassword(pw); // sessionStorage, this tab only
          editMode = true;
          document.body.classList.add("edit-mode");
          updateModeUI();
          closeModal();
          renderAll();
          setSaveStatus("", "");
        } else if (res.status === 401) {
          setModalError("Incorrect password.");
        } else {
          let msg = `Server error (HTTP ${res.status}).`;
          try {
            const e = await res.json();
            if (e && e.error) msg = e.error;
          } catch {}
          setModalError(msg);
        }
      } catch (err) {
        setModalError("Could not reach the server.");
      }
    });
    setTimeout(() => pwInput.focus(), 50);
    pwInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onConfirm && onConfirm();
    });
  }

  function exitEditMode() {
    editMode = false;
    clearPassword(); // forget the password for this tab
    document.body.classList.remove("edit-mode");
    updateModeUI();
    updateSaveButton();
    // If we were on an edit-only tab (Race Entry), fall back to a public one.
    const active = $(".tab.active");
    if (active && active.classList.contains("edit-only")) switchTab("drivers");
    renderAll();
  }

  function updateModeUI() {
    const badge = $("#mode-badge");
    badge.textContent = editMode ? "Edit mode" : "Read-only";
    badge.classList.toggle("edit", editMode);
    $("#btn-edit").style.display = editMode ? "none" : "";
    $("#btn-lock").style.display = editMode ? "" : "none";
    updateSaveButton();
  }

  // --- tabs ------------------------------------------------------------------

  function switchTab(name) {
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === name + "-view"));
  }

  // --- render all ------------------------------------------------------------

  function renderAll() {
    $("#league-title").textContent = league.title;
    renderGrid();
    renderDriverBoard();
    renderTeamBoard();
    renderStageCards();
    renderPenaltyBoard();
  }

  // --- init ------------------------------------------------------------------

  function init() {
    // tabs
    $$(".tab").forEach((t) =>
      t.addEventListener("click", () => switchTab(t.dataset.view))
    );

    // auth + save
    $("#btn-edit").addEventListener("click", enterEditMode);
    $("#btn-lock").addEventListener("click", exitEditMode);
    $("#btn-save").addEventListener("click", saveChanges);

    // editor toolbar
    $("#btn-add-team").addEventListener("click", openAddTeam);
    $("#btn-add-driver").addEventListener("click", openAddDriver);
    $("#btn-add-race").addEventListener("click", openAddRace);
    $("#btn-add-penalty").addEventListener("click", () => openEditPenalty(null));

    // modal backdrop click to close
    $("#modal-backdrop").addEventListener("click", (e) => {
      if (e.target === $("#modal-backdrop")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // Warn before leaving with unsaved edits.
    window.addEventListener("beforeunload", (e) => {
      if (editMode && dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    updateModeUI();
    switchTab("drivers");
    // Fetch from the backend; renders happen inside loadLeague.
    loadLeague();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
