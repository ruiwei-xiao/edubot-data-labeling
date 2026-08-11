# Edubot Data Labeling

Browse Playlab conversation logs and system prompts. Data is loaded from a shared Google Sheet.

## Data source

Google Sheet: [playlab_activities_with_messages](https://docs.google.com/spreadsheets/d/1xNPMlwkfviJk2GuDdrVZHnBTOF2LILGSoKQo5IxDGaQ/edit?usp=sharing)

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
