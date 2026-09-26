/* =========================================================
   QUIZ ARENA — FIREBASE CONNECTION
   Starts Firebase once, so every page can use:
     db        → the Realtime Database
     auth      → the admin login
     serverNow → the current time on Google's server (fair timers)
   ========================================================= */
firebase.initializeApp(window.QUIZ_CONFIG.firebase);
const db   = firebase.database();
const auth = firebase.auth();

// Each device's clock can be a few seconds wrong. Firebase tells us the
// difference, so every screen counts down from the SAME server time.
let serverOffset = 0;
db.ref(".info/serverTimeOffset").on("value", snap => { serverOffset = snap.val() || 0; });
const serverNow = () => Date.now() + serverOffset;
