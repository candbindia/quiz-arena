# Quiz Arena: Consulting & Beyond

A live, Kahoot-style quiz for C&B. The host screen goes on the projector, players join on their phones with a PIN, and the admin creates and reuses quizzes on the website.

## Pages
| Page | Who uses it | Address |
|---|---|---|
| `index.html` | Players (phones) | `https://candbindia.github.io/<repo-name>/` |
| `admin.html` | Admin: log in with the PIN, create quizzes, start games, view results | `.../admin.html` |
| `host.html`  | Projector screen (opened automatically by **▶ Start game**) | `.../host.html?pin=123456` |

## Files
| File | What it does |
|---|---|
| `config.js` | Company name, logo, colours, Firebase keys, admin login email (the only file you normally edit) |
| `theme.js` | Applies the logo, name and colours from `config.js` |
| `style.css` | Look and layout (Cambria font) |
| `firebase.js` | Connects to Firebase (database, admin login, server time) |
| `admin.js` | Admin panel: login, quiz editor, teams, start game, live games, results |
| `host.js` | Projector: lobby, questions, timer, scoring, leaderboard, podium, close game |
| `play.js` | Phones: join, answer, points, rank |
| `results.js` | Saves results when a game closes; CSV download |
| `logo.png` | C&B logo |
| `firebase-rules.json` | Copy of the Realtime Database rules (paste into Firebase → Rules) |

## How a session runs
1. Open `admin.html` and log in with the admin PIN
2. **+ New quiz** (or edit one): title, teams (optional), questions → **Save**
3. **▶ Start game** → the projector shows the join link, QR code and PIN
4. Players scan the QR code, enter their name and pick a team
5. **▶ Start quiz** → questions → reveal → leaderboard … → 🏆 podium
6. **✔ Close game & save results** → results appear in **📊 Results** (View / CSV / Delete)

## Scoring
- Correct answer: 1000 points if instant, sliding to 500 at the last second
- Streak bonus: +100 for 2 in a row, +200 for 3 … up to +500
- Teams are ranked by **average** score per player
- Change the numbers at the top of `host.js` (`MAX_POINTS`, `MIN_POINTS`, `STREAK_BONUS`, `STREAK_MAX`, `LB_SIZE`)

## Firebase setup (already done for cb-quiz-arena)
- **Realtime Database** (asia-southeast1) with the rules in `firebase-rules.json`
- **Authentication → Email/Password**, with the admin user `quizadmin@candb.quiz` (password = admin PIN)
- **Authentication → Settings → Authorized domains** includes `candbindia.github.io`
- To change the admin PIN: Firebase → Authentication → Users → ⋮ → Reset password

## Hosting
GitHub Pages: repository → **Settings → Pages** → Branch `main`, folder `/ (root)` → **Save**.
