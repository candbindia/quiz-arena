/* =========================================================
   QUIZ ARENA — PLAYER PAGE (phones)
   Step 7: 1) enter PIN  2) name + team (from the quiz)  3) wait in lobby
   Step 8: answer buttons, countdown, correct / wrong after each question
   Step 9: points, streaks, rank, final position
   Step 10: "Game over" when the host closes (the game is deleted)
   ========================================================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SHAPES = ["▲", "◆", "●", "■"];

let pin = null, game = null, teams = [];
let playerId = null, gameRef = null, playerRef = null;

// Live copies of what the host sets
let state, current = null, reveal = null, me = null;   // state stays "undefined" until the first update
let shownQuestion = -1, timerLoop = null;

function showScreen(id) {
  ["pinScreen", "nameScreen", "answerScreen", "waitScreen"].forEach(s => $(s).classList.toggle("hidden", s !== id));
}
function showMessage(emoji, title, text, spinning = true, style = "", points = "") {
  $("waitBox").className = "card narrow big-msg " + style;     // style: "", "good" or "bad"
  $("waitEmoji").textContent = emoji;
  $("waitTitle").textContent = title;
  $("waitPoints").textContent = points;
  $("waitPoints").classList.toggle("hidden", !points);
  $("waitText").textContent  = text;
  $("spinner").classList.toggle("hidden", !spinning);
  showScreen("waitScreen");
}

// Remember the last name typed on this phone (just for convenience)
try { $("nameInput").value = localStorage.getItem("quiz-name") || ""; } catch (e) {}

/* ---------- My answers (kept in this tab, so a refresh can't answer twice) ---------- */
const myAnswers = () => { try { return JSON.parse(sessionStorage.getItem("quiz-answers-" + pin)) || {}; } catch (e) { return {}; } };
function saveMyAnswer(index, choice) {
  const all = myAnswers();
  all[index] = choice;
  sessionStorage.setItem("quiz-answers-" + pin, JSON.stringify(all));
}

/* =========================================================
   STEP 1 — Check the PIN
   ========================================================= */
async function checkPin() {
  const err = msg => { $("pinError").textContent = msg; $("pinBtn").disabled = false; };
  const p = $("pinInput").value.trim();
  if (!/^\d{6}$/.test(p)) return err("Enter the 6-digit PIN from the big screen.");

  $("pinBtn").disabled = true;
  $("pinError").textContent = "";
  try {
    const g = (await db.ref("games/" + p).get()).val();
    if (!g || !g.state)         return err("No game found with that PIN.");
    if (g.state === "closed")   return err("That game has already finished.");

    pin = p;
    game = g;
    teams = g.teams || [];
    showNameScreen();
  } catch (e) {
    err("Could not check the PIN: " + e.message);
  }
  $("pinBtn").disabled = false;
}
$("pinBtn").onclick = checkPin;
$("pinInput").addEventListener("keydown", e => { if (e.key === "Enter") checkPin(); });

/* =========================================================
   STEP 2 — Name + team dropdown (teams come from the quiz)
   ========================================================= */
function showNameScreen() {
  $("quizName").textContent = "🎯 " + game.quizTitle;

  if (teams.length) {
    $("teamInput").innerHTML = `<option value="">Choose your team…</option>` +
      teams.map(t => `<option>${esc(t)}</option>`).join("");
    $("teamBox").classList.remove("hidden");
  } else {
    $("teamBox").classList.add("hidden");    // this quiz has no teams
  }
  $("joinError").textContent = "";
  showScreen("nameScreen");
  $("nameInput").focus();
}

$("changePinBtn").onclick = () => { $("pinInput").value = ""; showScreen("pinScreen"); $("pinInput").focus(); };
$("joinBtn").onclick = () => join();
$("nameInput").addEventListener("keydown", e => { if (e.key === "Enter") join(); });

async function join(saved) {
  const err = msg => {
    if (saved) {                      // auto re-join failed → start again from the PIN screen
      sessionStorage.removeItem("quiz-player");
      $("pinError").textContent = msg;
      showScreen("pinScreen");
      return;
    }
    $("joinError").textContent = msg;
    $("joinBtn").disabled = false;
  };

  const name = saved ? saved.name : $("nameInput").value.trim();
  const team = saved ? saved.team : (teams.length ? $("teamInput").value : "");

  if (!name)                  return err("Enter your name.");
  if (teams.length && !team)  return err("Choose your team.");

  $("joinBtn").disabled = true;
  $("joinError").textContent = "";

  try {
    // 1. Read the game again (fresh list of players, and check it's still open)
    gameRef = db.ref("games/" + pin);
    const g = (await gameRef.get()).val();
    if (!g || g.state === "closed") return err("That game has already finished.");

    // 2. Is the name already taken by someone else?
    const players = g.players || {};
    const taken = Object.entries(players).some(([id, pl]) =>
      id !== (saved && saved.playerId) && pl.name.toLowerCase() === name.toLowerCase());
    if (taken) return err("Someone already has that name. Add your initial, e.g. Priya S.");

    // 3. Add (or re-add) this player
    playerId  = (saved && saved.playerId) || gameRef.child("players").push().key;
    playerRef = gameRef.child("players/" + playerId);

    // (In the lobby we always write it, in case a refresh removed it a moment ago)
    if (!players[playerId] || g.state === "lobby") {
      await playerRef.set({ name, team, score: 0, joinedAt: firebase.database.ServerValue.TIMESTAMP });
    }

    // 4. Remember this player in this browser tab, so a refresh re-joins automatically
    sessionStorage.setItem("quiz-player", JSON.stringify({ pin, playerId, name, team }));
    try { localStorage.setItem("quiz-name", name); } catch (e) {}

    // 5. From now on, the HOST controls what this phone shows
    playerRef.on("value",                snap => { if (snap.val()) me = snap.val(); updateHeader(); render(); });
    gameRef.child("current").on("value", snap => { current = snap.val(); render(); });
    gameRef.child("reveal").on("value",  snap => { reveal  = snap.val(); render(); });
    gameRef.child("state").on("value",   snap => { state   = snap.val(); onStateChange(); });
  } catch (e) {
    err("Could not join: " + e.message);
  }
}

/* =========================================================
   STEP 3 — React to the game state set by the host
   ========================================================= */
function onStateChange() {
  if (state === "lobby") {
    // While waiting in the lobby, if this phone disconnects, remove the player from the list
    playerRef.onDisconnect().remove();
  } else {
    // Game has started (or ended): keep the player and their score even if they drop out
    playerRef.onDisconnect().cancel();
  }
  if (state === "closed" || state === null) sessionStorage.removeItem("quiz-player");
  render();
}

// Top-right corner: name, team and live score
function updateHeader() {
  if (!me) return;
  $("me").innerHTML = `${esc(me.name)}<small>${me.team ? esc(me.team) + " · " : ""}${(me.score || 0).toLocaleString()} pts</small>`;
}

function render() {
  if (state === undefined || !me) return;
  if (state !== "question") clearInterval(timerLoop);

  if (state === "lobby") {
    showMessage("🎉", "You're in!", "Look at the big screen. The quiz will start soon.");
  }
  else if (state === "question" && current) {
    const endAt = current.startAt + current.time * 1000;
    if (myAnswers()[current.index] !== undefined) {
      showMessage("🔒", "Answer locked in!", "Waiting for everyone else…");
    } else if (serverNow() > endAt) {
      showMessage("⏰", "Time's up!", "Get ready for the next one.");
    } else if (shownQuestion !== current.index) {
      showAnswerButtons();
    }
  }
  else if (state === "reveal" && reveal && current) {
    showResult();
  }
  else if (state === "leaderboard") {
    showMessage("📊", `You're #${me.rank || "-"}`, "Watch the leaderboard on the big screen!", false, "",
                `${(me.score || 0).toLocaleString()} pts`);
  }
  else if (state === "ended") {
    const r = me.rank || 0;
    const medal = ["🥇", "🥈", "🥉"][r - 1] || "🎉";
    showMessage(medal, r ? `You finished #${r}` : "Quiz complete!", `Thanks for playing, ${me.name}!`, false, "",
                `${(me.score || 0).toLocaleString()} pts`);
  }
  else if (state === "closed" || state === null) {
    showMessage("👋", "Game over", "The host has closed this game. Thanks for playing!", false);
  }
}

/* =========================================================
   STEP 4 — Answer buttons + countdown
   ========================================================= */
function showAnswerButtons() {
  shownQuestion = current.index;
  const n = current.options.length;

  $("pQuestion").textContent = `Question ${current.index + 1} of ${game ? game.total : "?"}`;
  $("answerGrid").className = "answer-grid" + (n === 2 ? " two" : "");
  $("answerGrid").innerHTML = current.options.map((o, i) => `
    <button class="opt o${i}" data-choice="${i}">
      <span class="shape">${SHAPES[i]}</span><span>${esc(o)}</span>
    </button>`).join("");
  showScreen("answerScreen");

  // Countdown
  const endAt = current.startAt + current.time * 1000;
  clearInterval(timerLoop);
  const tick = () => {
    const left = Math.max(0, Math.ceil((endAt - serverNow()) / 1000));
    $("pTimer").textContent = `⏱ ${left}s`;
    if (left <= 0) { clearInterval(timerLoop); render(); }   // shows "Time's up!"
  };
  tick();
  timerLoop = setInterval(tick, 250);
}

// One tap = final answer
$("answerGrid").onclick = async e => {
  const btn = e.target.closest("button[data-choice]");
  if (!btn || !current) return;
  const index  = current.index;
  const choice = Number(btn.dataset.choice);
  if (myAnswers()[index] !== undefined) return;        // already answered

  saveMyAnswer(index, choice);                         // lock it on this phone first
  clearInterval(timerLoop);
  if (navigator.vibrate) navigator.vibrate(40);        // small buzz on Android
  showMessage("🔒", "Answer locked in!", "Waiting for everyone else…");

  // Save the answer with the SERVER time (used for fair timing and speed points)
  await gameRef.child(`answers/${index}/${playerId}`).set({
    choice, at: firebase.database.ServerValue.TIMESTAMP
  });
};

/* =========================================================
   STEP 5 — Correct or wrong?
   ========================================================= */
function showResult() {
  const mine = myAnswers()[reveal.index];
  const correctText = (current.options || [])[reveal.correct] || "";
  const rank = me.rank ? ` · You're #${me.rank}` : "";

  if (mine === undefined) {
    showMessage("⏰", "No answer", `The answer was: ${correctText}${rank}`, false, "bad");
  } else if (mine === reveal.correct) {
    const streak = me.streak > 1 ? `🔥 ${me.streak} in a row!` : "Nice one!";
    showMessage("✅", "Correct!", streak + rank, false, "good", `+${me.lastPoints || 0}`);
  } else {
    showMessage("❌", "Wrong", `The answer was: ${correctText}${rank}`, false, "bad");
  }
}

/* =========================================================
   On page load
   ========================================================= */
const urlPin = new URLSearchParams(location.search).get("pin");
let saved = null;
try { saved = JSON.parse(sessionStorage.getItem("quiz-player")); } catch (e) {}

if (saved && (!urlPin || urlPin === saved.pin)) {
  // Page was refreshed after joining → re-join automatically
  pin = saved.pin;
  db.ref("games/" + pin).get().then(s => { game = s.val(); join(saved); });
} else if (urlPin) {
  // Came from the QR code → PIN is known, go straight to name + team
  $("pinInput").value = urlPin;
  checkPin();
}
