# 🛣️ AI Roadway

A zoomable cartoon timeline of AI: milestones so far, fresh AI headlines filed under every day, and playful predictions for the road ahead.

- `data/events.json` — milestones and predictions (edit this to add or move a signpost; `"k":"pred"` marks a prediction)
- `data/news/` — headlines by day, written by `scripts/update-news.mjs`
- `.github/workflows/daily-news.yml` — runs the updater automatically and commits the results

Predictions are speculative and for fun. Headlines link to their original publishers.
