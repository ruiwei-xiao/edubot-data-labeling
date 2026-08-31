from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from app.bot_labels import list_labels, load_labels, set_bot_label
from app.message_labels import list_message_labels, load_message_labels, set_message_label
from app.cost_analysis import compute_cost_analysis
from app.label_analysis import compute_label_analysis
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


@app.get("/cost_analysis", response_class=HTMLResponse)
async def cost_analysis_page():
    path = FRONTEND_DIR / "cost_analysis.html"
    if not path.exists():
        path = STATIC_DIR / "cost_analysis.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="cost_analysis.html not found")
    return path.read_text(encoding="utf-8")


@app.get("/label_analysis", response_class=HTMLResponse)
async def label_analysis_page():
    path = FRONTEND_DIR / "label_analysis.html"
    if not path.exists():
        path = STATIC_DIR / "label_analysis.html"
    if not path.exists():
        raise HTTPException(status_code=404, detail="label_analysis.html not found")
    return path.read_text(encoding="utf-8")


def _asset_response(name: str) -> FileResponse:
    """Serve a frontend asset, revalidated on every load so edits show up."""
    path = FRONTEND_DIR / name
    if not path.exists():
        path = STATIC_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{name} not found")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


@app.get("/styles.css")
async def styles():
    return _asset_response("styles.css")


@app.get("/app.js")
async def app_js():
    return _asset_response("app.js")


@app.get("/cost_analysis.js")
async def cost_analysis_js():
    return _asset_response("cost_analysis.js")


@app.get("/label_analysis.js")
async def label_analysis_js():
    return _asset_response("label_analysis.js")


@app.get("/api/filters")
async def filters(
    user: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
    coding: Optional[str] = Query(default=None),
    editor: Optional[str] = Query(default=None),
    disagreed: bool = Query(default=False),
):
    return {
        "conversations": get_conversation_filter_options(
            user=user,
            app=app,
            builder_only=builder_only,
            needs_attention=needs_attention,
            coding=coding,
            editor=editor,
            disagreed=disagreed,
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
async def get_message_labels(
    conv_id: Optional[str] = Query(default=None),
    editor: Optional[str] = Query(default=None),
):
    return list_message_labels(conv_id=conv_id, editor=editor)


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


@app.get("/api/label-analysis")
async def label_analysis(
    editor: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    user: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
    sample_only: bool = Query(default=False),
):
    return compute_label_analysis(
        editor=editor,
        app=app,
        user=user,
        builder_only=builder_only,
        needs_attention=needs_attention,
        sample_only=sample_only,
    )


@app.get("/api/conversations")
async def list_conversations(
    user: Optional[str] = Query(default=None),
    app: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    builder_only: bool = Query(default=False),
    needs_attention: bool = Query(default=False),
    coding: Optional[str] = Query(default=None),
    editor: Optional[str] = Query(default=None),
    disagreed: bool = Query(default=False),
):
    from app.message_labels import (
        coded_conversation_ids,
        disagreed_message_numbers_by_conv,
        labeled_message_numbers_by_conv,
    )

    items = filter_conversations(
        user=user,
        app=app,
        q=q,
        builder_only=builder_only,
        needs_attention=needs_attention,
        coding=coding,
        editor=editor,
        disagreed=disagreed,
    )
    labeled_by_conv = labeled_message_numbers_by_conv(editor)
    coded_ids = coded_conversation_ids(items, labeled_by_conv, editor=editor)
    disputed = disagreed_message_numbers_by_conv()
    rows = []
    for conv in items:
        row = conversation_list_item(conv, coded_ids, editor=editor)
        row["disagreed_count"] = len(disputed.get(conv["id"]) or ())
        rows.append(row)
    return {"count": len(rows), "conversations": rows}


@app.get("/api/conversations/{conv_id}")
async def conversation_detail(
    conv_id: str,
    editor: Optional[str] = Query(default=None),
):
    conv = get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    payload = dict(conv)
    activity = find_activity_by_title(conv.get("title") or "")
    payload["app_config"] = activity_config_summary(activity) if activity else None
    payload["message_labels"] = list_message_labels(conv_id=conv_id, editor=editor)["labels"]
    payload["coding_editor"] = (editor or "").strip().lower()

    from app.message_labels import disagreement_details

    details = disagreement_details(conv_id)
    payload["disagreed_messages"] = sorted(details, key=lambda m: int(m) if m.isdigit() else 0)
    payload["disagreement_details"] = details
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
