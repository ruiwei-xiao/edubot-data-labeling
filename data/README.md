# Data files

Primary source is the shared Google Sheet:

https://docs.google.com/spreadsheets/d/1xNPMlwkfviJk2GuDdrVZHnBTOF2LILGSoKQo5IxDGaQ/edit?usp=sharing

| Tab | Used for |
|-----|----------|
| `all_data_origin` | Conversations view |
| `system_prompt (origin)` | System prompts view |

Codebook (separate spreadsheet):

https://docs.google.com/spreadsheets/d/1XwkVPvlQ-kOys8OBn0jTEgYWme8YNqoibVLpkH_tED4/edit?usp=sharing

| Tab | Used for |
|-----|----------|
| `codebook` | Labeling codebook (synced to app) |

At build/deploy time, `scripts/fetch_sheets.py` downloads those tabs and writes:

- `data/cache/conversations.json`
- `data/cache/activities.json`
- `data/cache/codebook_sheet.json` (+ merges into `data/codebooks.json` as `google-sheet`)

Local CSV fallbacks (optional):

| File | Notes |
|------|-------|
| `playlab_activities_with_messages - system_prompt (origin).csv` | Tracked |
| `playlab_activities_with_messages - all_data_origin.csv` | Local only (~109MB, not committed) |
