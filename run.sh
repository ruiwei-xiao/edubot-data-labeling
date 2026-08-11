#!/usr/bin/env bash
cd "$(dirname "$0")"
source venv/bin/activate 2>/dev/null || { python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt; }
uvicorn app.main:app --reload --port 8080
