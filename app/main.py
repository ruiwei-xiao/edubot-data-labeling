from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.bot_labels import list_labels, load_labels, set_bot_label
from app.message_labels import list_message_labels, load_message_labels, set_message_label
from app.cost_analysis import compute_cost_analysis
from app.conversations_loader import (
    conversation_list_item,
    filter_conversations,
    get_conversation,
    get_conversation_filter_options,
    load_conversations,
)
from app.data_loader import (
    activity_config_summary,
    find_activity_by_title,
    load_activities,
)
from pydantic import BaseModel, Field

app = FastAPI(title="Playlab Activities Browser")

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
PUBLIC_DIR = ROOT / "public"
FRONTEND_DIR = PUBLIC_DIR if (PUBLIC_DIR / "index.html").exists() else STATIC_DIR

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class BotLabelUpdate(BaseModel):
    code: str = Field(default="")
    editor: str = Field(default="")


class MessageLabelUpdate(BaseModel):
    code: str = Field(default="")
    codes: list[str] = Field(default_factory=list)  # legacy
    rationale: str = Field(default="")
    iterative: bool = Field(default=False)
    editor: str = Field(default="")
    role: str = Field(default="")


@app.on_event("startup")
def warmup():
    # Prefer cache built at deploy time; otherwise fetch/local fallback.
    load_activities()
    load_conversations()
    load_labels()
    load_message_labels()


@app.get("/", response_class=HTMLResponse)
async def index():
    return (FRONTEND_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/styles.css")
async def styles():
    path = FRONTEND_DIR / "styles.css"
    if not path.exists():
        path = STATIC_DIR / "styles.css"
    return FileResponse(path)


@app.get("/app.js")
async def app_js():
    path = FRONTEND_DIR / "app.js"
    if not path.exists():
        path = STATIC_DIR / "app.js"
    return FileResponse(path)


@app.get("/api/filters")
async def filters(
    user: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
):
    return {
        "conversations": get_conversation_filter_options(
            user=user,
            app=app,
            builder_only=builder_only,
            needs_attention=needs_attention,
        ),
    }


@app.get("/api/bot-labels")
async def get_bot_labels():
    return list_labels()


@app.put("/api/bot-labels/{bot_title:path}")
async def put_bot_label(bot_title: str, body: BotLabelUpdate):
    try:
        return set_bot_label(bot_title, body.code, body.editor)
    except PermissionError as err:
        raise HTTPException(status_code=403, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.get("/api/message-labels")
async def get_message_labels(conv_id: Optional[str] = Query(default=None)):
    return list_message_labels(conv_id=conv_id)


@app.put("/api/message-labels/{conv_id}/{message_number}")
async def put_message_label(conv_id: str, message_number: str, body: MessageLabelUpdate):
    try:
        return set_message_label(
            conv_id,
            message_number,
            body.editor,
            role=body.role,
            code=body.code,
            codes=body.codes,
            rationale=body.rationale,
            iterative=body.iterative,
        )
    except PermissionError as err:
        raise HTTPException(status_code=403, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@app.get("/api/cost-analysis")
async def cost_analysis(
    user: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
):
    return compute_cost_analysis(
        user=user,
        app=app,
        q=q,
        builder_only=builder_only,
        needs_attention=needs_attention,
    )


@app.get("/api/conversations")
async def list_conversations(
    user: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
):
    items = filter_conversations(
        user=user,
        app=app,
        q=q,
        builder_only=builder_only,
        needs_attention=needs_attention,
    )
    return {
        "count": len(items),
        "conversations": [conversation_list_item(c) for c in items],
    }


@app.get("/api/conversations/{conv_id}")
async def conversation_detail(conv_id: str):
    conv = get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    payload = dict(conv)
    activity = find_activity_by_title(conv.get("title") or "")
    payload["app_config"] = activity_config_summary(activity) if activity else None
    payload["message_labels"] = list_message_labels(conv_id=conv_id)["labels"]
    return payload


@app.post("/api/refresh")
async def refresh_data():
    from app.conversations_loader import reload_conversations
    from app.data_loader import reload_activities

    reload_activities()
    reload_conversations()
    load_labels(force=True)
    load_message_labels(force=True)
    activities = load_activities(force_refresh=True)
    conversations = load_conversations(force_refresh=True)
    return {
        "activities": len(activities),
        "conversations": len(conversations),
        "bot_labels": len(list_labels()["labels"]),
        "message_labels": len(list_message_labels()["labels"]),
    }
