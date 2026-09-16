# Geography Bowl Review

This folder contains the complete static Geography Bowl Review site. It keeps the green card layout and study dashboard of the supplied History Bowl site, but replaces the game and content with Geography Bowl rules. It does not require Node.js, a database, or a build command.

## Included features

- Category and subcategory practice across five balanced regional specialties
- One-round, 20-minute full games with equal-value questions
- 20-minute AI games with ten mildly concave-down difficulty levels (20% through 95%)
- Two throwouts per team; the AI automatically uses its first two on questions it misses
- Automatic steals after an incorrect answer unless the original team uses a throwout
- Compendium search and filters, missed-question review, spaced repetition, mastered-question tracking, detailed statistics, and local leaderboards
- Practice-packet PDF printing, study tips, and optional text-to-speech
- Optional local profiles whose progress remains in that browser

Videos and the knowledge graph are intentionally not included.

## Publish with GitHub Pages

1. Extract the ZIP file.
2. Create a new GitHub repository, or open the repository you want to use.
3. Upload **the files inside the extracted folder** to the root of the repository. Do not upload only the ZIP file.
4. Commit the files to the `main` branch.
5. Open the repository's **Settings → Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select the `main` branch and the `/(root)` folder, then save.

GitHub will show the public Pages URL after deployment finishes.

## Files

- `index.html` — page structure and content
- `styles.css` — visual design and responsive layout
- `app.js` — practice, full-game, AI, throwout, steal, compendium, and progress logic
- `questions.json` — question bank
- `.nojekyll` — tells GitHub Pages to serve the files directly

All profiles, progress, settings, and leaderboards use browser storage. They do not sync across devices because GitHub Pages is a static host.

## Add or replace questions

Questions are stored as an array in `questions.json`. Each entry uses this structure:

```json
{
  "id": "unique-id",
  "category": "Europe + Russia",
  "subcategory": "Western Europe",
  "topic": "Rivers",
  "question": "Question text",
  "answer": "Accepted answer",
  "aliases": ["another accepted answer"]
}
```

The future Jeopardy classification program can output this same structure, allowing its results to replace or extend `questions.json` without changing the rest of the website.

## Local testing

Because the site loads `questions.json`, some browsers will block it if `index.html` is opened directly as a local file. GitHub Pages will serve it correctly. For local testing, use any basic static web server.
