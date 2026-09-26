/* =========================================================
   QUIZ ARENA — HOST SCREEN (projector)
   Opened by admin.html as host.html?pin=123456

   Game flow (the host controls games/<PIN>/state):
     lobby → question → reveal → leaderboard → question → … → ended → closed

   Step 6: lobby (PIN, join link, QR, live player list, close game)
   Step 7: shows each player's team in the lobby
   Step 8: live questions, countdown, answer count, reveal
   Step 9: points, streaks, leaderboard, team ranking, podium
   Step 10: close & save results, download CSV
   ========================================================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SHAPES = ["▲", "◆", "●", "■"];
const TS = firebase.database.ServerValue.TIMESTAMP;   // "use the server's clock"

/* ---------- Scoring rules (change these if you like) ---------- */
const MAX_POINTS   = 1000;   // correct answer given instantly
const MIN_POINTS   = 500;    // correct answer given at the last second
const STREAK_BONUS = 100;    // extra points for each correct answer in a row…
const STREAK_MAX   = 5;      // …up to this many in a row (max +500)
const LB_SIZE      = 5;      // how many names to show on the leaderboard

const pin = new URLSearchParams(location.search).get("pin");
const gameRef = db.ref("games/" + pin);

let game = null;       // the games/<pin> record
let quiz = null;       // the full quiz, WITH correct answers (only the host has this)
let players = {};      // live list of players
let qIndex = -1;       // which question we're on (0 = first)
let phase = "lobby";   // what the host is doing right now
let timerLoop = null, stopAnswers = null, playersAtStart = 0;

const SCREENS = ["lobbyScreen", "questionScreen", "revealScreen", "leaderScreen", "endScreen", "errorScreen"];
function showScreen(id) {
  SCREENS.forEach(s => $(s).classList.toggle("hidden", s !== id));
  $("loading").classList.add("hidden");
  window.scrollTo(0, 0);
}
function showError(msg) { $("errorText").textContent = msg; showScreen("errorScreen"); }

/* =========================================================
   1. Only a logged-in admin can host
   ========================================================= */
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
auth.onAuthStateChanged(user => {
  if (!user) { location.href = "admin.html"; return; }   // not logged in → go to login
  loadGame();
});

/* =========================================================
   2. Load the game and its quiz
   ========================================================= */
async function loadGame() {
  if (!/^\d{6}$/.test(pin || "")) return showError("No game PIN in the link.");

  game = (await gameRef.get()).val();
  if (!game)                    return showError(`Game ${pin} doesn't exist.`);
  if (game.state === "closed")  return showError(`Game ${pin} is already closed.`);

  quiz = (await db.ref("quizzes/" + game.quizId).get()).val();
  if (!quiz) return showError("The quiz for this game was deleted.");

  $("closeBtn").classList.remove("hidden");
  $("topPin").textContent = "PIN " + pin;

  // Keep a live copy of the players (used by every screen)
  players = game.players || {};
  gameRef.child("players").on("value", snap => {
    players = snap.val() || {};
    if (phase === "lobby") renderLobby();
  });

  // If the host page was refreshed in the middle of a game, carry on from where it was
  qIndex = typeof game.qIndex === "number" ? game.qIndex : -1;
  if (game.state === "question")         { phase = "question"; endQuestion(); }
  else if (game.state === "reveal")      { showReveal(game.reveal); }
  else if (game.state === "leaderboard") { showLeaderboard(); }
  else if (game.state === "ended")       { showEnd(); }
  else                                   { showLobby(); }
}

/* =========================================================
   3. Lobby
   ========================================================= */
function showLobby() {
  phase = "lobby";
  $("quizTitle").textContent = quiz.title;
  $("pinBig").textContent = pin;

  // Player page address = this folder (index.html opens automatically)
  const base = new URL("./", location.href).href;          // e.g. https://candbindia.github.io/quiz-arena/
  $("joinUrl").textContent = base.replace(/^https?:\/\//, "");

  // QR code opens the player page with the PIN already filled in
  $("qr").innerHTML = "";
  if (window.QRCode) new QRCode($("qr"), { text: base + "?pin=" + pin, width: 200, height: 200 });

  renderLobby();
  showScreen("lobbyScreen");
}

function renderLobby() {
  const list = Object.values(players);
  $("playerCount").textContent = list.length;
  $("startQuizBtn").disabled = list.length === 0;
  $("playerList").innerHTML = list.length
    ? list.map(p => `<span class="chip">${esc(p.name)}${p.team ? ` <small>· ${esc(p.team)}</small>` : ""}</span>`).join("")
    : "<p>Waiting for players…</p>";
}

$("startQuizBtn").onclick = () => showQuestion(0);

/* =========================================================
   4. Show a question
   ========================================================= */
async function showQuestion(i) {
  qIndex = i;
  phase = "question";
  const q = quiz.questions[i];

  // Send the question to the phones — WITHOUT the correct answer
  await gameRef.update({
    state:   "question",
    qIndex:  i,
    reveal:  null,
    current: { index: i, text: q.text, options: q.options, time: q.time, startAt: TS }
  });
  // Read back the exact server time the question started
  const startAt = (await gameRef.child("current/startAt").get()).val() || serverNow();

  // Draw the question on the big screen
  $("qCounter").textContent = `Question ${i + 1} of ${quiz.questions.length}`;
  $("qText").textContent = q.text;
  $("qOptions").innerHTML = q.options.map((o, oi) =>
    `<div class="opt o${oi}"><span class="shape">${SHAPES[oi]}</span><span>${esc(o)}</span></div>`).join("");
  showScreen("questionScreen");

  // Live answer counter — ends the question early when everyone has answered
  playersAtStart = Object.keys(players).length;
  const answersRef = gameRef.child("answers/" + i);
  const handler = answersRef.on("value", snap => {
    const n = Object.keys(snap.val() || {}).length;
    $("answeredCount").textContent = `${n} / ${playersAtStart} answered`;
    if (phase === "question" && playersAtStart > 0 && n >= playersAtStart) endQuestion();
  });
  stopAnswers = () => answersRef.off("value", handler);

  // Countdown (uses server time, so it matches the phones)
  const endAt = startAt + q.time * 1000;
  clearInterval(timerLoop);
  const tick = () => {
    const left = Math.max(0, Math.ceil((endAt - serverNow()) / 1000));
    $("timer").textContent = left;
    $("timer").classList.toggle("low", left <= 5);
    if (left <= 0) endQuestion();
  };
  tick();
  timerLoop = setInterval(tick, 200);
}

$("skipBtn").onclick = () => endQuestion();

/* =========================================================
   5. End the question → score everyone → reveal
   ========================================================= */
async function endQuestion() {
  if (phase !== "question") return;      // make sure this only runs once
  phase = "reveal";
  clearInterval(timerLoop);
  if (stopAnswers) { stopAnswers(); stopAnswers = null; }

  const q = quiz.questions[qIndex];
  const g = (await gameRef.get()).val();                 // fresh copy of the whole game
  const startAt = (g.current && g.current.startAt) || 0;
  const answers = (g.answers && g.answers[qIndex]) || {};
  players = g.players || {};

  const counts  = q.options.map(() => 0);
  const updates = { state: "reveal", reveal: { index: qIndex, correct: q.correct, counts } };

  // Only score each question once (protects against a refresh at the wrong moment)
  const alreadyScored = g.scoredQ === qIndex;

  for (const [pid, p] of Object.entries(players)) {
    const a = answers[pid];
    const secs = a ? (a.at - startAt) / 1000 : Infinity;
    const inTime = a && secs <= q.time + 1;              // 1 second grace for slow Wi-Fi
    if (inTime && counts[a.choice] !== undefined) counts[a.choice]++;
    if (alreadyScored) continue;

    let points = 0, streak = p.streak || 0;
    const correct = inTime && a.choice === q.correct;
    if (correct) {
      streak += 1;
      // Speed points: 1000 if instant, sliding down to 500 at the last second
      const speed = Math.min(Math.max(secs, 0) / q.time, 1);
      points = Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * speed);
      // Streak bonus: +100 for the 2nd correct in a row, +200 for the 3rd … up to +500
      points += Math.min(streak - 1, STREAK_MAX) * STREAK_BONUS;
    } else {
      streak = 0;
    }
    p.score = (p.score || 0) + points;
    p.streak = streak;
    updates[`players/${pid}/score`]       = p.score;
    updates[`players/${pid}/streak`]      = streak;
    updates[`players/${pid}/lastPoints`]  = points;
    updates[`players/${pid}/lastCorrect`] = !!correct;
    updates[`players/${pid}/answered`]    = !!inTime;
    updates[`players/${pid}/correct`]     = (p.correct || 0) + (correct ? 1 : 0);   // for the results report
  }

  if (!alreadyScored) {
    // Rank everyone (1 = highest score) so each phone can show "You're #3"
    ranked().forEach(([pid], i) => { updates[`players/${pid}/rank`] = i + 1; });
    updates.scoredQ = qIndex;
    // Question statistics for the results report
    updates[`stats/${qIndex}`] = { answered: counts.reduce((a, b) => a + b, 0), correct: counts[q.correct] || 0 };
  }

  await gameRef.update(updates);        // ONE write: reveal + all scores together
  showReveal(updates.reveal);
}

function showReveal(reveal) {
  phase = "reveal";
  qIndex = reveal.index;
  const q = quiz.questions[qIndex];
  const counts = reveal.counts || q.options.map(() => 0);
  const max = Math.max(1, ...counts);

  $("rText").textContent = q.text;

  // Bar chart: how many players picked each option
  $("rBars").innerHTML = counts.map((c, i) => `
    <div class="bar-wrap">
      <div class="bar" style="background:var(--opt${i}); height:36px" data-h="${36 + Math.round(c / max * 160)}">${c}</div>
      <div class="bar-label">${SHAPES[i]}${i === q.correct ? " ✓" : ""}</div>
    </div>`).join("");

  // Options: correct one highlighted, others faded
  $("rOptions").innerHTML = q.options.map((o, i) => `
    <div class="opt o${i} ${i === q.correct ? "correct" : "dim"}">
      <span class="shape">${SHAPES[i]}</span><span>${esc(o)}</span>
      ${i === q.correct ? '<span class="tick">✓</span>' : ""}
    </div>`).join("");

  showScreen("revealScreen");

  // Grow the bars (small animation)
  requestAnimationFrame(() => setTimeout(() =>
    document.querySelectorAll("#rBars .bar").forEach(b => b.style.height = b.dataset.h + "px"), 50));
}

$("nextBtn").onclick = async () => {
  await gameRef.update({ state: "leaderboard" });
  showLeaderboard();
};

/* =========================================================
   6. Leaderboard (after every question)
   ========================================================= */
// Players sorted by score, highest first
function ranked() {
  return Object.entries(players).sort((a, b) => (b[1].score || 0) - (a[1].score || 0));
}

// Teams: ranked by AVERAGE score per player, so a team of 3 can beat a team of 10
function teamRanking() {
  const t = {};
  Object.values(players).forEach(p => {
    if (!p.team) return;
    t[p.team] = t[p.team] || { total: 0, members: 0 };
    t[p.team].total += p.score || 0;
    t[p.team].members += 1;
  });
  return Object.entries(t)
    .map(([name, v]) => ({ name, total: v.total, members: v.members, avg: Math.round(v.total / v.members) }))
    .sort((a, b) => b.avg - a.avg);
}

function playerRows(list, showGain) {
  return list.map(([, p], i) => `
    <div class="lb-row ${i < 3 ? "top" : ""}" style="animation-delay:${i * 0.08}s">
      <span class="rank">${i + 1}</span>
      <span class="who">${esc(p.name)}${p.team ? `<small>${esc(p.team)}</small>` : ""}</span>
      <span class="pts">${(p.score || 0).toLocaleString()}${showGain && p.lastPoints ? `<span class="gain">+${p.lastPoints}</span>` : ""}</span>
    </div>`).join("") || "<p>No players.</p>";
}

function teamRows() {
  return teamRanking().map((t, i) => `
    <div class="lb-row ${i === 0 ? "top" : ""}" style="animation-delay:${i * 0.08}s">
      <span class="rank">${i + 1}</span>
      <span class="who">${esc(t.name)}<small>${t.members} player${t.members > 1 ? "s" : ""} · total ${t.total.toLocaleString()}</small></span>
      <span class="pts">${t.avg.toLocaleString()}<small style="font-size:12px;color:var(--cb-grey)"> avg</small></span>
    </div>`).join("");
}

async function showLeaderboard() {
  phase = "leaderboard";
  players = (await gameRef.child("players").get()).val() || {};
  $("lbCounter").textContent = `After question ${qIndex + 1} of ${quiz.questions.length}`;
  $("lbList").innerHTML = playerRows(ranked().slice(0, LB_SIZE), true);

  const teams = teamRows();
  $("lbTeamCard").classList.toggle("hidden", !teams);
  $("lbTeams").innerHTML = teams;

  const last = qIndex >= quiz.questions.length - 1;
  $("lbNextBtn").textContent = last ? "Final results 🏆" : "Next question ▶";
  showScreen("leaderScreen");
}

$("lbNextBtn").onclick = async () => {
  if (qIndex >= quiz.questions.length - 1) {
    await gameRef.update({ state: "ended", endedAt: TS });
    showEnd();
  } else {
    showQuestion(qIndex + 1);
  }
};

/* =========================================================
   7. Final results: podium + full ranking
   ========================================================= */
async function showEnd() {
  phase = "ended";
  players = (await gameRef.child("players").get()).val() || {};
  const list = ranked();

  $("endTitle").textContent = quiz.title;

  // Podium order on screen: 2nd, 1st, 3rd
  $("podium").innerHTML = [1, 0, 2].filter(i => list[i]).map(i => {
    const p = list[i][1];
    return `
      <div class="pod p${i + 1}">
        <div class="name">${esc(p.name)}</div>
        <div class="team">${esc(p.team || "")}</div>
        <div class="block">${["🥇", "🥈", "🥉"][i]}</div>
        <div class="pts">${(p.score || 0).toLocaleString()} pts</div>
      </div>`;
  }).join("");

  $("finalList").innerHTML = playerRows(list, false);
  const teams = teamRows();
  $("finalTeamCard").classList.toggle("hidden", !teams);
  $("finalTeams").innerHTML = teams;

  showScreen("endScreen");
}

/* =========================================================
   8. Download results + close the game (Step 10)
   closeGame() and downloadCSV() live in results.js
   ========================================================= */
$("csvBtn").onclick = async () => {
  const g = (await gameRef.get()).val();
  const r = buildResult(pin, g, quiz);
  r.closedAt = Date.now();                // (not closed yet — use "now" for the file name)
  downloadCSV(r);
};

async function closeAndSave() {
  const playing = phase !== "ended" && phase !== "lobby";
  const msg = playing
    ? `The quiz is still running. Close game ${pin} now? Results so far will be saved.`
    : `Close game ${pin}? Results will be saved and the PIN will stop working.`;
  if (!confirm(msg)) return;

  clearInterval(timerLoop);
  if (stopAnswers) stopAnswers();
  phase = "closing";
  $("closeBtn").disabled = $("endCloseBtn").disabled = true;
  try {
    await closeGame(pin);                 // saves results/<id>, deletes games/<PIN>
    location.href = "admin.html#results"; // open the Results tab in admin
  } catch (err) {
    alert("Could not close the game: " + err.message);
    $("closeBtn").disabled = $("endCloseBtn").disabled = false;
  }
}
$("closeBtn").onclick = closeAndSave;
$("endCloseBtn").onclick = closeAndSave;
