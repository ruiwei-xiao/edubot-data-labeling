# Playlab Browser

Browse two Playlab CSV exports in one UI:

1. **Conversations** — `data/playlab_activities_with_messages - all_data_origin.csv`  
   (1744 conversations / ~18k messages)
2. **System prompts** — `data/playlab_activities_with_messages - system_prompt (origin).csv`  
   (214 activity configs)

## Run

```bash
cd playlab_log_processor
source venv/bin/activate
uvicorn app.main:app --reload --port 8080
```

Open http://localhost:8080

## Features

- Toggle between **Conversations** and **System prompts**
- Filter by **App**, **User**, and (for system prompts) **Model**
- Search across titles, prompts, and message text
- Conversation detail shows full message thread + system prompt
- Builder / Needs attention filters
