/* =========================================================
   QUIZ ARENA — SETTINGS
   Change your company name, logo and colours here only.
   Every page reads from this file.
   ========================================================= */
window.QUIZ_CONFIG = {

  org: {
    name:    "Consulting & Beyond",
    appName: "Quiz Arena",
    logoUrl: "logo.png"
  },

  theme: {
    amber: "#F1AB3C",   // logo bar  → buttons, highlights
    grey:  "#646767",   // logo text → secondary text
    dark:  "#2E3131",   // main text
    white: "#FFFFFF",   // header and cards
    bg:    "#F4F5F5",   // page background
    optionColors: ["#E21B3C", "#1368CE", "#D89E00", "#26890C"]
  },

  // Firebase connection (from Firebase → Project settings → Your apps)
  firebase: {
    apiKey:            "AIzaSyDrMoHKQAdXAhb7eOGL59u70fKTH1jTyCQ",
    authDomain:        "cb-quiz-arena.firebaseapp.com",
    databaseURL:       "https://cb-quiz-arena-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "cb-quiz-arena",
    storageBucket:     "cb-quiz-arena.firebasestorage.app",
    messagingSenderId: "804176830621",
    appId:             "1:804176830621:web:8e46df594f04713f8ab474"
  },

  // Login name of the admin account (the admin PIN is its password)
  adminEmail: "quizadmin@candb.quiz"
};
