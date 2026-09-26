/* =========================================================
   QUIZ ARENA — RESULTS (shared by host.js and admin.js)
   1. buildResult()   → turns a finished game into a results record
   2. closeGame()     → saves results/<id>, then deletes games/<PIN>
   3. downloadCSV()   → results as a CSV file that opens in Excel

   How results are saved in Firebase:
   results/
     <resultId>/
       quizTitle, pin, startedAt, closedAt, completed,
       questionsPlayed, questionsTotal,
       players:   [ { rank, name, team, score, correct } ]
       teams:     [ { rank, name, members, total, avg } ]
       questions: [ { text, answer, answered, correct } ]
   ========================================================= */

function buildResult(pin, game, quiz) {
  const played = typeof game.scoredQ === "number" ? game.scoredQ + 1 : 0;

  // Players, highest score first
  const players = Object.values(game.players || {})
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((p, i) => ({ rank: i + 1, name: p.name, team: p.team || "", score: p.score || 0, correct: p.correct || 0 }));

  // Teams, by average score per player
  const t = {};
  players.forEach(p => {
    if (!p.team) return;
    t[p.team] = t[p.team] || { total: 0, members: 0 };
    t[p.team].total += p.score;
    t[p.team].members += 1;
  });
  const teams = Object.entries(t)
    .map(([name, v]) => ({ name, members: v.members, total: v.total, avg: Math.round(v.total / v.members) }))
    .sort((a, b) => b.avg - a.avg)
    .map((x, i) => ({ rank: i + 1, ...x }));

  // How each question went
  const stats = game.stats || {};
  const questions = ((quiz && quiz.questions) || []).slice(0, played).map((q, i) => ({
    text: q.text,
    answer: q.options[q.correct],
    answered: (stats[i] && stats[i].answered) || 0,
    correct:  (stats[i] && stats[i].correct)  || 0
  }));

  return {
    pin,
    quizId:          game.quizId || "",
    quizTitle:       game.quizTitle || (quiz && quiz.title) || "Quiz",
    startedAt:       game.createdAt || null,
    closedAt:        firebase.database.ServerValue.TIMESTAMP,
    completed:       game.state === "ended",       // false = closed before the last question
    questionsPlayed: played,
    questionsTotal:  game.total || questions.length,
    players, teams, questions
  };
}

// Save the results (if any question was played) and delete the live game.
// Returns the new result id, or null if there was nothing to save.
async function closeGame(pin) {
  const gameRef = db.ref("games/" + pin);
  const game = (await gameRef.get()).val();
  if (!game) return null;

  let resultId = null;
  if (typeof game.scoredQ === "number" && game.players) {
    const quiz = (await db.ref("quizzes/" + game.quizId).get()).val();
    const ref = db.ref("results").push();
    await ref.set(buildResult(pin, game, quiz));
    resultId = ref.key;
  }

  // Deleting the game frees the PIN and tells every phone "Game over"
  await gameRef.remove();
  return resultId;
}

/* ---------- CSV (opens in Excel / Google Sheets) ---------- */
function formatDate(ms) {
  return ms ? new Date(ms).toLocaleString() : "";
}

function resultToCSV(r) {
  const rows = [
    ["Quiz", r.quizTitle],
    ["Date", formatDate(r.closedAt)],
    ["Game PIN", r.pin],
    ["Questions played", `${r.questionsPlayed} of ${r.questionsTotal}`],
    [],
    ["Rank", "Name", "Team", "Score", "Correct answers"],
    ...(r.players || []).map(p => [p.rank, p.name, p.team, p.score, p.correct])
  ];
  if ((r.teams || []).length) {
    rows.push([], ["Team rank", "Team", "Players", "Total score", "Average score"],
      ...r.teams.map(t => [t.rank, t.name, t.members, t.total, t.avg]));
  }
  if ((r.questions || []).length) {
    rows.push([], ["#", "Question", "Correct answer", "Answered", "Answered correctly", "% correct"],
      ...r.questions.map((q, i) => [i + 1, q.text, q.answer, q.answered, q.correct,
        q.answered ? Math.round(q.correct / q.answered * 100) + "%" : "-"]));
  }
  // Put every cell in quotes (so commas inside text don't break columns)
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + rows.map(row => row.map(cell).join(",")).join("\r\n");   // ﻿ = Excel reads ₹, Tamil etc. correctly
}

function downloadCSV(r) {
  const blob = new Blob([resultToCSV(r)], { type: "text/csv;charset=utf-8" });
  const day  = new Date(typeof r.closedAt === "number" ? r.closedAt : Date.now()).toISOString().slice(0, 10);
  const name = `${r.quizTitle}-${day}`.replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
