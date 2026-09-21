# Changelog

## 2026-08-26 — Voice interview improvements (commit 51d6952)

Summary:
- Improved browser SpeechRecognition handling to reliably capture interim and final transcripts.
- Enabled the 'Next' button immediately when a final transcript is produced so the interview flow no longer shows "No answer captured." after a valid speech input.
- Preserved the last captured transcript and used it as a fallback when recognition ends with an empty textarea.
- Cleared and aborted recognition on errors so subsequent microphone toggles create a fresh recognition object.
- Minor UI/UX status message improvements for clearer feedback (listening, captured, permission denied).

Files changed (high level):
- frontend/app.js — core speech flow and interview logic fixes
- frontend/index.html, frontend/styles.css — small UI updates
- backend/ai_engine.js, backend/server.js, server.js, app.js, index.html, styles.css — related runtime/server fixes and env handling
- .env.example — clarified environment variables for AI provider configuration

How to test locally:
1. Start the server (from project root): `node backend/server.js` (or use the project's preferred start command).
2. Open: http://localhost:3000 in a Chromium-based browser (Chrome/Edge recommended).
3. Navigate: Student Portal → Voice Interview Prep.
4. Click Start → Click the Listen / microphone button and grant mic permission when prompted.
5. Speak a clear answer; wait a second for the final transcript. Confirm the transcript appears, the status shows the captured state, and the Next button enables.

Security & notes:
- No secrets or .env values were committed. `.env` is listed in `.gitignore`.
- If you want this change to go through a PR instead of being pushed directly to `main`, create a branch and open a PR for review.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
