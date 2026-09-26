/* =========================================================
   QUIZ ARENA — ADMIN PANEL
   1. Login / logout
   2. Quiz list  (live from Firebase)
   3. Quiz editor (create, edit, save questions + teams)
   4. Start a game
   5. Live games (open the host screen again, or close & save)
   6. Results history (view, download CSV, delete)

   How a quiz is saved in Firebase:
   quizzes/
     <quizId>/
       title:       "Onboarding Quiz"
       description: "…"
       teams:       ["Consulting", "Technology"]   // optional
       updatedAt:   1727340000000
       questions: [
         { text: "What does BPR stand for?",
           options: ["…", "…", "…", "…"],
           correct: 0,          // 0=A 1=B 2=C 3=D
           time: 20 }           // seconds
       ]
   ========================================================= */
const $ = id => document.getElementById(id);
const SHAPES  = ["▲", "◆", "●", "■"];
const LETTERS = ["A", "B", "C", "D"];

// Makes any text safe to put inside HTML (stops broken layouts / code injection)
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Show one screen, hide the others
const SCREENS = ["loginScreen", "listScreen", "editScreen", "resultsScreen", "resultScreen"];
function showScreen(id) {
  SCREENS.forEach(s => $(s).classList.toggle("hidden", s !== id));
  // Tabs are shown on the two "home" screens only
  $("tabs").classList.toggle("hidden", !["listScreen", "resultsScreen"].includes(id));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === id));
  window.scrollTo(0, 0);
}

// Tab clicks
$("tabs").onclick = e => {
  const tab = e.target.closest(".tab");
  if (tab) showScreen(tab.dataset.tab);
};

/* =========================================================
   1. LOGIN / LOGOUT
   ========================================================= */
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);

let stopListeners = [];     // functions that switch off the live listeners on logout

// Start a LIVE listener (runs now, and again whenever the data changes) and remember how to stop it
function listen(path, onData) {
  const ref = db.ref(path);
  const handler = ref.on("value", snap => onData(snap.val() || {}),
                         err => console.error(path, err.message));
  stopListeners.push(() => ref.off("value", handler));
}

auth.onAuthStateChanged(user => {
  $("loading").classList.add("hidden");
  $("logoutBtn").classList.toggle("hidden", !user);
  if (user) {
    if (!stopListeners.length) {
      listen("quizzes", data => { allQuizzes = data; renderQuizList(); });
      listen("games",   data => { renderLiveGames(data); });
      listen("results", data => { allResults = data; renderResultList(); });
    }
    // host.html sends us to admin.html#results after closing a game
    if (location.hash === "#results") { history.replaceState(null, "", "admin.html"); showScreen("resultsScreen"); }
    else showScreen("listScreen");
  } else {
    stopListeners.forEach(stop => stop());
    stopListeners = [];
    showScreen("loginScreen");
    $("pin").value = "";
    $("pin").focus();
  }
});

async function login() {
  const pin = $("pin").value.trim();
  if (pin.length < 6) { $("loginError").textContent = "PIN must be at least 6 digits"; return; }
  $("loginBtn").disabled = true;
  $("loginError").textContent = "";
  try {
    await auth.signInWithEmailAndPassword(QUIZ_CONFIG.adminEmail, pin);
  } catch (err) {
    const messages = {
      "auth/invalid-credential":        "Wrong PIN. Please try again.",
      "auth/wrong-password":            "Wrong PIN. Please try again.",
      "auth/invalid-login-credentials": "Wrong PIN. Please try again.",
      "auth/user-not-found":            "Admin account not found. Check adminEmail in config.js.",
      "auth/too-many-requests":         "Too many wrong attempts. Wait a few minutes and try again.",
      "auth/network-request-failed":    "No internet connection."
    };
    $("loginError").textContent = messages[err.code] || err.message;
  }
  $("loginBtn").disabled = false;
}
$("loginBtn").onclick = login;
$("pin").addEventListener("keydown", e => { if (e.key === "Enter") login(); });

$("logoutBtn").onclick = () => {
  if (dirty && !confirm("You have unsaved changes. Log out anyway?")) return;
  dirty = false;
  auth.signOut();
};

/* =========================================================
   2. QUIZ LIST
   ========================================================= */
let allQuizzes = {};   // filled LIVE by listen("quizzes") above

function renderQuizList() {
  const entries = Object.entries(allQuizzes)
    .sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));   // newest first

  if (!entries.length) {
    $("quizList").innerHTML = `<div class="card empty">No quizzes yet. Click <b>+ New quiz</b> to create your first one.</div>`;
    return;
  }

  $("quizList").innerHTML = entries.map(([id, q]) => {
    const n = (q.questions || []).length;
    const updated = q.updatedAt ? new Date(q.updatedAt).toLocaleString() : "";
    return `
      <div class="quiz-item">
        <div>
          <h3>${esc(q.title)}</h3>
          <div class="meta">${n} question${n === 1 ? "" : "s"} · updated ${esc(updated)}</div>
          ${q.description ? `<div class="meta">${esc(q.description)}</div>` : ""}
          ${(q.teams || []).length ? `<div class="meta">👥 Teams: ${q.teams.map(esc).join(", ")}</div>` : ""}
        </div>
        <span class="spacer"></span>
        <button class="btn small" data-start="${id}">▶ Start game</button>
        <button class="btn ghost small" data-edit="${id}">✏️ Edit</button>
        <button class="btn ghost small" data-copy="${id}">📄 Duplicate</button>
        <button class="btn danger small" data-del="${id}">🗑 Delete</button>
      </div>`;
  }).join("");
}

// One click handler for all the list buttons ("event delegation")
$("quizList").onclick = async e => {
  const btn = e.target.closest("button");
  if (!btn) return;

  if (btn.dataset.edit) openEditor(btn.dataset.edit);
  if (btn.dataset.start) startGame(btn.dataset.start, btn);

  if (btn.dataset.copy) {
    const src = allQuizzes[btn.dataset.copy];
    await db.ref("quizzes").push({
      ...src, title: src.title + " (copy)", updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  if (btn.dataset.del) {
    const q = allQuizzes[btn.dataset.del];
    if (confirm(`Delete "${q.title}"? This cannot be undone.`)) {
      await db.ref("quizzes/" + btn.dataset.del).remove();
    }
  }
};

$("newQuizBtn").onclick = () => openEditor(null);

/* =========================================================
   3. QUIZ EDITOR
   ========================================================= */
let editingId = null;   // null = new quiz, otherwise the Firebase id
let questions = [];     // working copy of the questions
let dirty = false;      // true = unsaved changes
let teams = [];         // team names for this quiz (players choose from these)

function blankQuestion() {
  return { text: "", options: ["", "", "", ""], correct: 0, time: 20 };
}

function openEditor(id) {
  editingId = id;
  const quiz = id ? allQuizzes[id] : null;
  $("editTitle").textContent = quiz ? "Edit quiz" : "New quiz";
  $("quizTitle").value = quiz ? quiz.title : "";
  $("quizDesc").value  = quiz ? (quiz.description || "") : "";
  teams = quiz ? [...(quiz.teams || [])] : [];
  $("teamName").value = "";
  renderTeams();

  // Deep copy, and always show 4 option boxes (blank ones for true/false questions)
  questions = quiz
    ? (quiz.questions || []).map(q => ({
        text: q.text, correct: q.correct, time: q.time,
        options: [0, 1, 2, 3].map(i => (q.options || [])[i] || "")
      }))
    : [blankQuestion()];

  dirty = false;
  $("saveMsg").textContent = "";
  renderQuestions();
  showScreen("editScreen");
}

/* ---------- Teams ---------- */
function renderTeams() {
  $("teamChips").innerHTML = teams.length
    ? teams.map((t, i) => `<span class="chip">${esc(t)} <button class="chip-x" data-team="${i}" title="Remove">✕</button></span>`).join("")
    : `<p style="margin:0">No teams. Players will join without choosing a team.</p>`;
}

function addTeam() {
  const name = $("teamName").value.trim();
  if (!name) return;
  if (teams.some(t => t.toLowerCase() === name.toLowerCase())) { alert(`"${name}" is already in the list.`); return; }
  if (teams.length >= 12) { alert("Maximum 12 teams."); return; }
  teams.push(name);
  $("teamName").value = "";
  $("teamName").focus();
  dirty = true;
  renderTeams();
}
$("addTeamBtn").onclick = addTeam;
$("teamName").addEventListener("keydown", e => { if (e.key === "Enter") addTeam(); });

$("teamChips").onclick = e => {
  const btn = e.target.closest("button[data-team]");
  if (!btn) return;
  teams.splice(Number(btn.dataset.team), 1);
  dirty = true;
  renderTeams();
};

// Draw every question card from the `questions` array
function renderQuestions() {
  $("questionList").innerHTML = questions.map((q, qi) => `
    <div class="q-card" data-q="${qi}">
      <div class="q-top">
        <span class="q-num">Question ${qi + 1}</span>
        <span class="spacer"></span>
        <button class="icon-btn" data-act="up"   title="Move up"   ${qi === 0 ? "disabled" : ""}>⬆️</button>
        <button class="icon-btn" data-act="down" title="Move down" ${qi === questions.length - 1 ? "disabled" : ""}>⬇️</button>
        <button class="icon-btn" data-act="del"  title="Delete question">🗑</button>
      </div>

      <textarea data-field="text" maxlength="200" placeholder="Type your question…">${esc(q.text)}</textarea>

      ${q.options.map((opt, oi) => `
        <div class="opt-row">
          <span class="swatch" style="background: var(--opt${oi})">${SHAPES[oi]}</span>
          <input type="text" data-opt="${oi}" maxlength="80" value="${esc(opt)}"
                 placeholder="Option ${LETTERS[oi]}${oi >= 2 ? " (optional)" : ""}">
          <label class="correct">
            <input type="radio" name="correct-${qi}" value="${oi}" ${q.correct === oi ? "checked" : ""}> Correct
          </label>
        </div>`).join("")}

      <div class="time-row">
        <label style="margin:0">⏱ Time limit</label>
        <select data-field="time">
          ${[10, 15, 20, 30, 45, 60].map(t => `<option value="${t}" ${q.time === t ? "selected" : ""}>${t} seconds</option>`).join("")}
        </select>
      </div>
    </div>`).join("");
}

// Typing in any box → update the `questions` array straight away
$("questionList").addEventListener("input", e => {
  const card = e.target.closest(".q-card");
  if (!card) return;
  const q = questions[Number(card.dataset.q)];
  const t = e.target;
  if (t.dataset.field === "text") q.text = t.value;
  if (t.dataset.field === "time") q.time = Number(t.value);
  if (t.dataset.opt !== undefined) q.options[Number(t.dataset.opt)] = t.value;
  if (t.type === "radio") q.correct = Number(t.value);
  dirty = true;
  $("saveMsg").textContent = "";
});
["quizTitle", "quizDesc"].forEach(id => $(id).addEventListener("input", () => { dirty = true; $("saveMsg").textContent = ""; }));

// Move up / move down / delete buttons on each card
$("questionList").addEventListener("click", e => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const qi = Number(btn.closest(".q-card").dataset.q);
  if (btn.dataset.act === "up")   [questions[qi - 1], questions[qi]] = [questions[qi], questions[qi - 1]];
  if (btn.dataset.act === "down") [questions[qi + 1], questions[qi]] = [questions[qi], questions[qi + 1]];
  if (btn.dataset.act === "del") {
    if (questions.length === 1) { alert("A quiz needs at least one question."); return; }
    if (!confirm(`Delete question ${qi + 1}?`)) return;
    questions.splice(qi, 1);
  }
  dirty = true;
  renderQuestions();
});

$("addQBtn").onclick = () => {
  questions.push(blankQuestion());
  dirty = true;
  renderQuestions();
  const cards = document.querySelectorAll(".q-card");
  cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
  cards[cards.length - 1].querySelector("textarea").focus();
};

$("backBtn").onclick = () => {
  if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
  dirty = false;
  showScreen("listScreen");
};

// Warn before closing the tab with unsaved work
window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- Check the quiz, then save it to Firebase ---------- */
function validate() {
  const title = $("quizTitle").value.trim();
  if (!title) return { error: "Please give the quiz a title." };

  const clean = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i], n = i + 1;
    if (!q.text.trim()) return { error: `Question ${n}: the question text is empty.` };
    if (!q.options[q.correct].trim()) return { error: `Question ${n}: the option marked "Correct" is empty.` };

    // Remove blank options, and keep the correct answer pointing at the right one
    const kept = [];
    let correct = 0;
    q.options.forEach((o, oi) => {
      if (o.trim()) { if (oi === q.correct) correct = kept.length; kept.push(o.trim()); }
    });
    if (kept.length < 2) return { error: `Question ${n}: needs at least 2 options.` };

    clean.push({ text: q.text.trim(), options: kept, correct, time: q.time });
  }
  return { quiz: { title, description: $("quizDesc").value.trim(), teams, questions: clean } };
}

$("saveBtn").onclick = async () => {
  const { error, quiz } = validate();
  if (error) { $("saveMsg").innerHTML = `<span class="error">❌ ${esc(error)}</span>`; return; }

  $("saveBtn").disabled = true;
  $("saveMsg").textContent = "Saving…";
  try {
    quiz.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    if (editingId) {
      await db.ref("quizzes/" + editingId).set(quiz);
    } else {
      editingId = db.ref("quizzes").push().key;    // push() creates a new unique id
      await db.ref("quizzes/" + editingId).set(quiz);
      $("editTitle").textContent = "Edit quiz";
    }
    dirty = false;
    $("saveMsg").innerHTML = `<span class="ok-msg">✅ Saved (${quiz.questions.length} questions)</span>`;
  } catch (err) {
    $("saveMsg").innerHTML = `<span class="error">❌ ${esc(err.message)}</span>`;
  }
  $("saveBtn").disabled = false;
};

/* =========================================================
   4. START A GAME
   Creates games/<PIN> in Firebase, then opens the host
   screen in this same tab (so the admin login carries over).
   ========================================================= */
async function startGame(quizId, btn) {
  const quiz = allQuizzes[quizId];
  if (!quiz || !(quiz.questions || []).length) { alert("This quiz has no questions yet."); return; }

  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    // 1. Pick a random 6-digit PIN that isn't already used by a live game
    let pin, existing;
    do {
      pin = String(Math.floor(100000 + Math.random() * 900000));
      existing = (await db.ref("games/" + pin + "/state").get()).val();
    } while (existing && existing !== "closed");

    // 2. Create the game record (players read this; the correct answers are NOT copied here)
    await db.ref("games/" + pin).set({
      quizId:    quizId,
      quizTitle: quiz.title,
      total:     quiz.questions.length,
      teams:     quiz.teams || [],       // players choose from these
      state:     "lobby",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      hostUid:   auth.currentUser.uid
    });

    // 3. Go to the host (projector) screen
    location.href = "host.html?pin=" + pin;
  } catch (err) {
    alert("Could not start the game: " + err.message);
    btn.disabled = false;
    btn.textContent = "▶ Start game";
  }
}

/* =========================================================
   5. LIVE GAMES  (added in Step 10)
   Any game that hasn't been closed yet. Useful if the host
   tab was closed by mistake: open it again, or close & save.
   ========================================================= */
const STATE_LABELS = { lobby: "Lobby", question: "Question on screen", reveal: "Showing answer",
                       leaderboard: "Leaderboard", ended: "Finished — not closed yet" };

function renderLiveGames(games) {
  const live = Object.entries(games).filter(([, g]) => g && g.state && g.state !== "closed")
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
  $("liveCard").classList.toggle("hidden", !live.length);
  $("liveList").innerHTML = live.map(([pin, g]) => {
    const n = Object.keys(g.players || {}).length;
    return `
      <div class="quiz-item">
        <div>
          <h3>${esc(g.quizTitle)} <span class="badge green">PIN ${pin}</span></h3>
          <div class="meta">${esc(STATE_LABELS[g.state] || g.state)} · ${n} player${n === 1 ? "" : "s"} · started ${esc(formatDate(g.createdAt))}</div>
        </div>
        <span class="spacer"></span>
        <button class="btn small" data-open="${pin}">▶ Open host screen</button>
        <button class="btn danger small" data-close="${pin}">✖ Close &amp; save</button>
      </div>`;
  }).join("");
}

$("liveList").onclick = async e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.open) location.href = "host.html?pin=" + btn.dataset.open;
  if (btn.dataset.close) {
    if (!confirm(`Close game ${btn.dataset.close}? Results so far will be saved and the PIN will stop working.`)) return;
    btn.disabled = true;
    try {
      const id = await closeGame(btn.dataset.close);     // from results.js
      if (id) alert("Game closed. Results saved in the 📊 Results tab.");
    } catch (err) { alert("Could not close: " + err.message); btn.disabled = false; }
  }
};

/* =========================================================
   6. RESULTS HISTORY  (added in Step 10)
   ========================================================= */
let allResults = {};    // filled LIVE by listen("results") above
let viewingId = null;   // result shown on the detail screen

function renderResultList() {
  const entries = Object.entries(allResults).sort((a, b) => (b[1].closedAt || 0) - (a[1].closedAt || 0));
  if (!entries.length) {
    $("resultList").innerHTML = `<div class="card empty">No results yet. Results appear here after you close a game.</div>`;
    return;
  }
  $("resultList").innerHTML = entries.map(([id, r]) => {
    const n = (r.players || []).length;
    const winner = (r.players || [])[0];
    return `
      <div class="quiz-item">
        <div>
          <h3>${esc(r.quizTitle)}
            ${r.completed ? `<span class="badge green">Completed</span>` : `<span class="badge amber">Stopped early</span>`}</h3>
          <div class="meta">${esc(formatDate(r.closedAt))} · ${n} player${n === 1 ? "" : "s"} · ${r.questionsPlayed} of ${r.questionsTotal} questions</div>
          ${winner ? `<div class="meta">🥇 ${esc(winner.name)}${winner.team ? " (" + esc(winner.team) + ")" : ""} · ${winner.score.toLocaleString()} pts</div>` : ""}
        </div>
        <span class="spacer"></span>
        <button class="btn small" data-view="${id}">👁 View</button>
        <button class="btn ghost small" data-csv="${id}">⬇ CSV</button>
        <button class="btn danger small" data-rdel="${id}">🗑 Delete</button>
      </div>`;
  }).join("");
}

$("resultList").onclick = e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.view) openResult(btn.dataset.view);
  if (btn.dataset.csv)  downloadCSV(allResults[btn.dataset.csv]);
  if (btn.dataset.rdel) deleteResult(btn.dataset.rdel);
};

async function deleteResult(id) {
  const r = allResults[id];
  if (!r || !confirm(`Delete the results of "${r.quizTitle}" (${formatDate(r.closedAt)})? This cannot be undone.`)) return;
  await db.ref("results/" + id).remove();
  if (viewingId === id) showScreen("resultsScreen");
}

function rankRow(rank, name, sub, value, top) {
  return `
    <div class="lb-row ${top ? "top" : ""}">
      <span class="rank">${rank}</span>
      <span class="who">${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>
      <span class="pts">${value}</span>
    </div>`;
}

function openResult(id) {
  const r = allResults[id];
  if (!r) return;
  viewingId = id;
  const players = r.players || [], teams = r.teams || [], qs = r.questions || [];

  $("rdTitle").textContent = r.quizTitle;
  $("rdMeta").textContent = `${formatDate(r.closedAt)} · PIN ${r.pin} · ${players.length} players · ` +
    `${r.questionsPlayed} of ${r.questionsTotal} questions${r.completed ? "" : " (stopped early)"}`;

  const medals = ["🥇", "🥈", "🥉"];
  $("rdPlayers").innerHTML = players.map(p => rankRow(medals[p.rank - 1] || p.rank, p.name,
      [p.team, `${p.correct}/${r.questionsPlayed} correct`].filter(Boolean).join(" · "),
      p.score.toLocaleString(), p.rank <= 3)).join("") || "<p>No players.</p>";

  $("rdTeamCard").classList.toggle("hidden", !teams.length);
  $("rdTeams").innerHTML = teams.map(t => rankRow(t.rank, t.name,
      `${t.members} player${t.members > 1 ? "s" : ""} · total ${t.total.toLocaleString()}`,
      `${t.avg.toLocaleString()} <small style="font-size:12px;color:var(--cb-grey)">avg</small>`, t.rank === 1)).join("");

  $("rdQCard").classList.toggle("hidden", !qs.length);
  $("rdQuestions").innerHTML = qs.map((q, i) => {
    const pct = q.answered ? Math.round(q.correct / q.answered * 100) : 0;
    const level = pct < 40 ? "low" : pct < 70 ? "mid" : "";
    return `
      <div class="q-stat">
        <div class="q">${i + 1}. ${esc(q.text)}</div>
        <div class="meta">✓ ${esc(q.answer)} · ${q.correct} of ${q.answered} answered correctly (${pct}%)</div>
        <div class="meter ${level}"><div style="width:${pct}%"></div></div>
      </div>`;
  }).join("");

  showScreen("resultScreen");
}

$("resultBackBtn").onclick = () => showScreen("resultsScreen");
$("rdCsvBtn").onclick = () => downloadCSV(allResults[viewingId]);
$("rdDelBtn").onclick = () => deleteResult(viewingId);
