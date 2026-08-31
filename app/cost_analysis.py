from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from app.conversations_loader import filter_conversations
from app.data_loader import find_activity_by_title

# Approximate USD per 1M tokens, keyed by Playlab model display names.
# Estimates only — not billed invoices.
MODEL_PRICING_USD_PER_MTOK: dict[str, dict[str, float]] = {
    "Claude 4.6 Sonnet": {"input": 3.0, "output": 15.0},
    "Claude 4.6 Sonnet (Reasoning)": {"input": 3.0, "output": 22.5},
    "Claude 4.5 Haiku": {"input": 1.0, "output": 5.0},
    "Claude 4.6 Opus": {"input": 15.0, "output": 75.0},
    "GPT 5.4": {"input": 1.25, "output": 10.0},
    "GPT 5.4 Mini": {"input": 0.25, "output": 2.0},
    "Gemini 3 Flash": {"input": 0.15, "output": 0.6},
    "Gemini 3.5 Flash": {"input": 0.3, "output": 2.5},
    "Gemini 3.1 Pro": {"input": 1.25, "output": 10.0},
    "Mistral Large 3": {"input": 2.0, "output": 6.0},
}

DEFAULT_PRICING = {"input": 3.0, "output": 15.0}
CHARS_PER_TOKEN = 4.0


def _chars_to_tokens(chars: int) -> int:
    if chars <= 0:
        return 0
    return max(1, int(round(chars / CHARS_PER_TOKEN)))


def pricing_for_model(model: str) -> dict[str, Any]:
    name = (model or "").strip()
    if not name or name.lower() == "republish":
        return {
            "model": name or "Unknown",
            "matched": False,
            "input": DEFAULT_PRICING["input"],
            "output": DEFAULT_PRICING["output"],
        }
    rates = MODEL_PRICING_USD_PER_MTOK.get(name)
    if rates:
        return {"model": name, "matched": True, "input": rates["input"], "output": rates["output"]}
    # fuzzy contain
    lower = name.lower()
    for key, rates in MODEL_PRICING_USD_PER_MTOK.items():
        if key.lower() in lower or lower in key.lower():
            return {"model": name, "matched": True, "input": rates["input"], "output": rates["output"]}
    return {
        "model": name,
        "matched": False,
        "input": DEFAULT_PRICING["input"],
        "output": DEFAULT_PRICING["output"],
    }


def estimate_conversation_usage(conv: dict[str, Any]) -> dict[str, int]:
    """Estimate billed input/output chars assuming each bot reply is one completion
    with system prompt + full prior transcript as input."""
    system = conv.get("system_prompt") or ""
    if not system:
        activity = find_activity_by_title(conv.get("title") or "")
        if activity:
            system = activity.get("system_prompt") or ""

    history: list[str] = []
    input_chars = 0
    output_chars = 0
    user_chars = 0
    bot_chars = 0
    bot_replies = 0

    for msg in conv.get("messages") or []:
        content = msg.get("content") or ""
        role = (msg.get("role") or "").strip().lower()
        if role == "user":
            user_chars += len(content)
            history.append(content)
            continue
        if role in {"bot", "assistant"}:
            bot_chars += len(content)
            bot_replies += 1
            ctx = system + "\n".join(history)
            input_chars += len(ctx)
            output_chars += len(content)
            history.append(content)

    return {
        "input_chars": input_chars,
        "output_chars": output_chars,
        "user_chars": user_chars,
        "bot_chars": bot_chars,
        "bot_replies": bot_replies,
        "message_count": len(conv.get("messages") or []),
        "prompt_chars": len(system),
    }


def _empty_bot_row(title: str, model: str, pricing: dict[str, Any]) -> dict[str, Any]:
    return {
        "bot": title,
        "model": model or "Unknown",
        "model_matched": bool(pricing.get("matched")),
        "pricing_input_per_mtok": pricing["input"],
        "pricing_output_per_mtok": pricing["output"],
        "conversations": 0,
        "messages": 0,
        "bot_replies": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_usd": 0.0,
        "input_cost_usd": 0.0,
        "output_cost_usd": 0.0,
    }


def _conversation_audience(conv: dict[str, Any]) -> str:
    if conv.get("is_builder"):
        return "author"
    user = (conv.get("user") or "").strip()
    user_raw = (conv.get("user_raw") or "").strip()
    if conv.get("is_anonymous") or user == "Anonymous" or user_raw == "Anonymous":
        return "anonymous"
    return "author"


def _empty_day_row(day_key: str) -> dict[str, Any]:
    return {
        "date": day_key,
        "conversations": 0,
        "author_conversations": 0,
        "anonymous_conversations": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_usd": 0.0,
        "author_cost_usd": 0.0,
        "anonymous_cost_usd": 0.0,
    }


def _fill_calendar_days(by_date: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Include every calendar day between first and last spend day (zeros for gaps)."""
    known = {k: v for k, v in by_date.items() if k and k != "unknown"}
    if not known:
        return []
    keys = sorted(known.keys())
    try:
        start = date.fromisoformat(keys[0][:10])
        end = date.fromisoformat(keys[-1][:10])
    except ValueError:
        return sorted(known.values(), key=lambda r: r["date"])

    filled: list[dict[str, Any]] = []
    cur = start
    while cur <= end:
        key = cur.isoformat()
        filled.append(known.get(key) or _empty_day_row(key))
        cur += timedelta(days=1)
    return filled


def compute_cost_analysis(
    user: Optional[str] = None,
    app: Optional[str] = None,
    q: Optional[str] = None,
    builder_only: bool = False,
    needs_attention: bool = False,
) -> dict[str, Any]:
    conversations = filter_conversations(
        user=user,
        app=app,
        q=q,
        builder_only=builder_only,
        needs_attention=needs_attention,
    )

    by_bot: dict[str, dict[str, Any]] = {}
    by_date: dict[str, dict[str, Any]] = {}
    unknown_model_convs = 0
    total_input_tokens = 0
    total_output_tokens = 0
    total_messages = 0
    total_bot_replies = 0
    authors: set[str] = set()
    dates: list[str] = []
    audience_stats = {
        "author": {"conversations": 0, "input_tokens": 0, "output_tokens": 0, "messages": 0},
        "anonymous": {"conversations": 0, "input_tokens": 0, "output_tokens": 0, "messages": 0},
    }

    for conv in conversations:
        title = (conv.get("title") or "Untitled").strip() or "Untitled"
        activity = find_activity_by_title(title)
        model = ((activity or {}).get("model") or "").strip()
        if not model:
            unknown_model_convs += 1
        pricing = pricing_for_model(model)
        usage = estimate_conversation_usage(conv)
        audience = _conversation_audience(conv)

        user_name = (conv.get("user") or conv.get("user_raw") or "").strip()
        if user_name and audience == "author":
            authors.add(user_name)
        date_sort = (conv.get("date_sort") or conv.get("date") or "").strip()
        if date_sort:
            dates.append(date_sort)
        day_key = (conv.get("date") or date_sort[:10] or "unknown").strip() or "unknown"

        row = by_bot.get(title)
        if not row:
            row = _empty_bot_row(title, model or "Unknown", pricing)
            by_bot[title] = row
        elif model and row["model"] == "Unknown":
            row["model"] = model
            row["model_matched"] = bool(pricing.get("matched"))
            row["pricing_input_per_mtok"] = pricing["input"]
            row["pricing_output_per_mtok"] = pricing["output"]

        in_tok = _chars_to_tokens(usage["input_chars"])
        out_tok = _chars_to_tokens(usage["output_chars"])
        in_cost = in_tok / 1_000_000 * row["pricing_input_per_mtok"]
        out_cost = out_tok / 1_000_000 * row["pricing_output_per_mtok"]
        day_cost = in_cost + out_cost

        row["conversations"] += 1
        row["messages"] += usage["message_count"]
        row["bot_replies"] += usage["bot_replies"]
        row["input_tokens"] += in_tok
        row["output_tokens"] += out_tok
        row["input_cost_usd"] += in_cost
        row["output_cost_usd"] += out_cost
        row["cost_usd"] += day_cost
        total_input_tokens += in_tok
        total_output_tokens += out_tok
        total_messages += usage["message_count"]
        total_bot_replies += usage["bot_replies"]

        aud = audience_stats[audience]
        aud["conversations"] += 1
        aud["input_tokens"] += in_tok
        aud["output_tokens"] += out_tok
        aud["messages"] += usage["message_count"]

        day = by_date.setdefault(
            day_key,
            {
                "date": day_key,
                "conversations": 0,
                "author_conversations": 0,
                "anonymous_conversations": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
                "author_cost_usd": 0.0,
                "anonymous_cost_usd": 0.0,
            },
        )
        day["conversations"] += 1
        day["input_tokens"] += in_tok
        day["output_tokens"] += out_tok
        day["cost_usd"] += day_cost
        if audience == "anonymous":
            day["anonymous_conversations"] += 1
            day["anonymous_cost_usd"] += day_cost
        else:
            day["author_conversations"] += 1
            day["author_cost_usd"] += day_cost

    bots = sorted(by_bot.values(), key=lambda r: (-r["cost_usd"], r["bot"].lower()))
    for row in bots:
        row["cost_usd"] = round(row["cost_usd"], 4)
        row["input_cost_usd"] = round(row["input_cost_usd"], 4)
        row["output_cost_usd"] = round(row["output_cost_usd"], 4)

    total_cost = round(sum(r["cost_usd"] for r in bots), 4)
    by_model: dict[str, dict[str, Any]] = {}
    for row in bots:
        m = row["model"]
        bucket = by_model.setdefault(
            m,
            {"model": m, "bots": 0, "conversations": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
        )
        bucket["bots"] += 1
        bucket["conversations"] += row["conversations"]
        bucket["input_tokens"] += row["input_tokens"]
        bucket["output_tokens"] += row["output_tokens"]
        bucket["cost_usd"] += row["cost_usd"]
    models = sorted(by_model.values(), key=lambda r: (-r["cost_usd"], r["model"].lower()))
    for row in models:
        row["cost_usd"] = round(row["cost_usd"], 4)

    n_convs = max(len(conversations), 1)
    n_authors = len(authors) or 1
    span_days = 1
    if len(dates) >= 2:
        try:
            from datetime import datetime

            parsed = sorted(datetime.fromisoformat(d.replace("Z", "+00:00")[:19]) for d in dates if d)
            if len(parsed) >= 2:
                span_days = max(1, (parsed[-1] - parsed[0]).days + 1)
        except ValueError:
            span_days = 1

    avg_in = total_input_tokens / n_convs
    avg_out = total_output_tokens / n_convs
    avg_msgs = total_messages / n_convs
    avg_in_per_msg = total_input_tokens / max(total_messages, 1)
    avg_out_per_msg = total_output_tokens / max(total_messages, 1)

    author_convs = audience_stats["author"]["conversations"]
    anon_convs = audience_stats["anonymous"]["conversations"]
    author_in = audience_stats["author"]["input_tokens"]
    author_out = audience_stats["author"]["output_tokens"]
    anon_in = audience_stats["anonymous"]["input_tokens"]
    anon_out = audience_stats["anonymous"]["output_tokens"]
    denom = n_authors * max(span_days, 1)

    total_input_cost = sum(r["input_cost_usd"] for r in bots)
    total_output_cost = sum(r["output_cost_usd"] for r in bots)
    mixed_input = (
        (total_input_cost / total_input_tokens) * 1_000_000
        if total_input_tokens > 0
        else DEFAULT_PRICING["input"]
    )
    mixed_output = (
        (total_output_cost / total_output_tokens) * 1_000_000
        if total_output_tokens > 0
        else DEFAULT_PRICING["output"]
    )
    mixed_pricing = {
        "input": round(mixed_input, 4),
        "output": round(mixed_output, 4),
    }

    timeline = _fill_calendar_days(by_date)
    running = 0.0
    running_author = 0.0
    running_anon = 0.0
    for row in timeline:
        row["cost_usd"] = round(float(row.get("cost_usd") or 0), 4)
        row["author_cost_usd"] = round(float(row.get("author_cost_usd") or 0), 4)
        row["anonymous_cost_usd"] = round(float(row.get("anonymous_cost_usd") or 0), 4)
        running += row["cost_usd"]
        running_author += row["author_cost_usd"]
        running_anon += row["anonymous_cost_usd"]
        row["cumulative_cost_usd"] = round(running, 4)
        row["cumulative_author_cost_usd"] = round(running_author, 4)
        row["cumulative_anonymous_cost_usd"] = round(running_anon, 4)

    return {
        "method": {
            "token_estimate": f"chars / {CHARS_PER_TOKEN:g}",
            "billing_model": (
                "Each bot reply billed as one completion; input = system prompt + prior "
                "messages; output = bot reply. Approximate public list prices."
            ),
            "pricing_usd_per_mtok": MODEL_PRICING_USD_PER_MTOK,
            "default_pricing_usd_per_mtok": DEFAULT_PRICING,
            "mixed_pricing_usd_per_mtok": mixed_pricing,
        },
        "summary": {
            "bots": len(bots),
            "conversations": len(conversations),
            "authors": len(authors),
            "span_days": span_days,
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
            "messages": total_messages,
            "bot_replies": total_bot_replies,
            "avg_input_tokens_per_conv": round(avg_in, 1),
            "avg_output_tokens_per_conv": round(avg_out, 1),
            "avg_messages_per_conv": round(avg_msgs, 3),
            "avg_input_tokens_per_message": round(avg_in_per_msg, 2),
            "avg_output_tokens_per_message": round(avg_out_per_msg, 2),
            "avg_conversations_per_author": round(len(conversations) / n_authors, 2),
            "avg_conversations_per_author_per_day": round(
                len(conversations) / n_authors / max(span_days, 1), 4
            ),
            "author_conversations": author_convs,
            "anonymous_conversations": anon_convs,
            "avg_author_conversations_per_author_per_day": round(author_convs / denom, 4),
            "avg_anonymous_conversations_per_author_per_day": round(anon_convs / denom, 4),
            "avg_author_input_tokens_per_conv": round(author_in / max(author_convs, 1), 1),
            "avg_author_output_tokens_per_conv": round(author_out / max(author_convs, 1), 1),
            "avg_anonymous_input_tokens_per_conv": round(anon_in / max(anon_convs, 1), 1),
            "avg_anonymous_output_tokens_per_conv": round(anon_out / max(anon_convs, 1), 1),
            "cost_usd": total_cost,
            "unknown_model_conversations": unknown_model_convs,
        },
        "bots": bots,
        "models": models,
        "by_date": timeline,
        "model_options": ["mixed", *MODEL_PRICING_USD_PER_MTOK.keys()],
    }
