# Data files

Primary source is the shared Google Sheet:

https://docs.google.com/spreadsheets/d/1xNPMlwkfviJk2GuDdrVZHnBTOF2LILGSoKQo5IxDGaQ/edit?usp=sharing

| Tab | Used for |
|-----|----------|
| `all_data_origin` | Conversations view |
| Tab | Used for |
|-----|----------|
| `all_data_origin` | Conversations view |
| `system_prompt (origin)` | System prompts view |
| `codebook` | Labeling codebook (UI edits write here; Sync sheet pulls from here) |

At build/deploy time, `scripts/fetch_sheets.py` downloads those tabs and writes:

- `data/cache/conversations.json`
- `data/cache/activities.json`
- merges `codebook` tab into `data/codebooks.json` (`default` book)

Runtime edits also save to `/tmp/playlab_codebooks.json` on Vercel when the bundled JSON is read-only.

Local CSV fallbacks (optional):

| File | Notes |
|------|-------|
| `playlab_activities_with_messages - system_prompt (origin).csv` | Tracked |
| `playlab_activities_with_messages - all_data_origin.csv` | Local only (~109MB, not committed) |
