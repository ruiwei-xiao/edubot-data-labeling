# Edubot Data Labeling

Browse Playlab conversation logs and system prompts. Data is loaded from a shared Google Sheet.

## Data source

- **Conversations** ← tab `all_data_origin`
- **System prompts** ← tab `system_prompt (origin)`

## Local run

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python scripts/fetch_sheets.py   # download sheet -> data/cache/
uvicorn app.main:app --reload --port 8080
```

Open http://localhost:8080

## Deploy (Vercel)

```bash
npx vercel --prod
```

Build runs `scripts/fetch_sheets.py` so production uses the latest Sheet tabs.

Env vars (optional):

| Variable | Default |
|----------|---------|
| `GOOGLE_SHEET_ID` | `1xNPMlwkfviJk2GuDdrVZHnBTOF2LILGSoKQo5IxDGaQ` |
| `GOOGLE_SHEET_ALL_DATA_TAB` | `all_data_origin` |
| `GOOGLE_SHEET_SYSTEM_PROMPT_TAB` | `system_prompt (origin)` |
| `GOOGLE_CREDENTIALS_JSON` | *(optional)* service-account JSON string for Sheet write-back |
| `GOOGLE_CREDENTIALS_PATH` | *(optional)* path to service-account JSON file |
| `GOOGLE_CODEBOOK_SHEET_ID` | *(optional)* defaults to `GOOGLE_SHEET_ID` |
| `GOOGLE_CODEBOOK_TAB` | `codebook` |
| `GOOGLE_CODEBOOK_BOOK_ID` | `default` *(which local codebook syncs with the sheet)* |

### Writing labels back to Google Sheet

Message labels are still saved locally to `data/message_labels.json`, and **also synced** to tab `all_data_origin` columns:

- `ruiwei_labeling` / `ruiwei_rationale`
- `jiayi_labeling` / `jiayi_rationale`

Setup:

1. Create a Google Cloud service account and download its JSON key.
2. Share the spreadsheet with that service account email as **Editor**.
3. Set `GOOGLE_CREDENTIALS_JSON` (Vercel) or `GOOGLE_CREDENTIALS_PATH` (local).
4. On first write, missing columns are auto-created on the sheet.

If credentials are missing, labeling still works locally; Sheet sync is skipped.

### Codebook ↔ Google Sheet

The labeling codebook (`Intent & outcome`) lives on tab **`codebook`** in the **same spreadsheet** as conversations and message labels.

- **Save in UI** → writes locally (`/tmp` on Vercel) **and** pushes rows to tab `codebook`
- **Sync sheet** / deploy build → pulls tab `codebook` into the `default` codebook

The service account already used for message labels needs **Editor** access on that spreadsheet (same as today). The `codebook` tab is created automatically on first write if missing.
