from __future__ import annotations

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
    unknown_model_convs = 0

    for conv in conversations:
        title = (conv.get("title") or "Untitled").strip() or "Untitled"
        activity = find_activity_by_title(title)
        model = ((activity or {}).get("model") or "").strip()
        if not model:
            unknown_model_convs += 1
        pricing = pricing_for_model(model)
        usage = estimate_conversation_usage(conv)

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

        row["conversations"] += 1
        row["messages"] += usage["message_count"]
        row["bot_replies"] += usage["bot_replies"]
        row["input_tokens"] += in_tok
        row["output_tokens"] += out_tok
        row["input_cost_usd"] += in_cost
        row["output_cost_usd"] += out_cost
        row["cost_usd"] += in_cost + out_cost

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

    return {
        "method": {
            "token_estimate": f"chars / {CHARS_PER_TOKEN:g}",
            "billing_model": (
                "Each bot reply billed as one completion; input = system prompt + prior "
                "messages; output = bot reply. Approximate public list prices."
            ),
            "pricing_usd_per_mtok": MODEL_PRICING_USD_PER_MTOK,
            "default_pricing_usd_per_mtok": DEFAULT_PRICING,
        },
        "summary": {
            "bots": len(bots),
            "conversations": len(conversations),
            "input_tokens": sum(r["input_tokens"] for r in bots),
            "output_tokens": sum(r["output_tokens"] for r in bots),
            "cost_usd": total_cost,
            "unknown_model_conversations": unknown_model_convs,
        },
        "bots": bots,
        "models": models,
    }
