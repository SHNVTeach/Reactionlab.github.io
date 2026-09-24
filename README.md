# Reaction Lab

Ad-free classroom reaction games (colour change, ruler drop, sound) for St. Hilary's Science.

**Live:** https://shnvteach.github.io/Reactionlab.github.io/

## Modes
- **Practise** – solo play, no class needed. Rounds are kept in the browser only.
- **Create a class (teacher)** – shows a 5-character code and QR code. Keep this tab open: it *is* the class.
  - Live leaderboard (best 5-trial average per game)
  - Class rounds: switch every student to one game and watch progress live, then show a podium
  - Toggle student challenges on/off, remove students
- **Join a class (student)** – enter the code or scan the QR. Play any game to appear on the leaderboard, or challenge a classmate:
  - **Live duel** – both play the same game at the same time with identical cue timings; lower average wins
  - **Beat my score** – classmate tries to beat your best average

## How it works
Static site on GitHub Pages. Class mode uses [PeerJS](https://peerjs.com) (WebRTC): the teacher's browser is the hub and students connect to it directly. The free PeerJS cloud server is only used to introduce devices. Nothing is stored online; everything disappears when the teacher ends the class or closes the tab.

If a school network blocks it, a self-hosted PeerServer can be used with `?peer=your.host:443`.

## Files
- `index.html`, `style.css`, `app.js`
- `lib/peerjs.min.js` (PeerJS 1.5.4, MIT), `lib/qrcode.js` (qrcode-generator 1.4.4, MIT)
