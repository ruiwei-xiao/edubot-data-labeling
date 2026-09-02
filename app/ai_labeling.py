"""Auto-label conversations with Claude using the active codebook."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from app.codebook import get_codebook
from app.conversations_loader import load_conversations
from app.message_labels import (
    AI_EDITOR,
    codes_for_role,
    extras_for_role,
    labelable_message_numbers,
    load_message_labels,
    message_key,
    save_message_labels,
    upsert_editor_label,
)

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-4-6"
CHARS_PER_TOKEN = 4.0
INPUT_USD_PER_MTOK = 3.0
OUTPUT_USD_PER_MTOK = 15.0
MAX_MESSAGE_CHARS = 12_000
MAX_SYSTEM_CHARS = 8_000

TASK_INSTRUCTION = """Label every user and bot message in the conversation below.

Return a single JSON object (no markdown fences):
{
  "labels": [
    {
      "message_number": "<number as string>",
      "role": "user" | "bot",
      "code": "<primary code from codebook>",
      "iterative": false,
      "rationale": "<short note; empty string if obvious>"
    }
  ]
}

Rules:
- Label each user and bot message exactly once.
- Use only codes defined in the codebook for that role.
- Set iterative=true only for user messages that revisit the same thread.
- Read the bot system prompt and full transcript before coding.
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def api_key_configured() -> bool:
    return bool((os.environ.get("ANTHROPIC_API_KEY") or "").strip())


def model_name() -> str:
    return (os.environ.get("ANTHROPIC_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _chars_to_tokens(chars: int) -> int:
    if chars <= 0:
        return 0
    return max(1, int(round(chars / CHARS_PER_TOKEN)))


def format_conversation_block(conv: dict[str, Any]) -> str:
    parts: list[str] = []
    cid = conv.get("conv_id") or conv.get("id") or ""
    title = conv.get("title") or ""
    parts.append(f"CONV_ID: {cid}")
    if title:
        parts.append(f"TITLE: {title}")
    system = (conv.get("system_prompt") or "").strip()
    if system:
        parts.append(f"SYSTEM PROMPT:\n{system[:MAX_SYSTEM_CHARS]}")
    parts.append("TRANSCRIPT:")
    for msg in conv.get("messages") or []:
        role = (msg.get("role") or "").strip().lower()
        if role not in {"user", "bot", "assistant"}:
            continue
        role_label = "bot" if role in {"bot", "assistant"} else "user"
        num = str(msg.get("message_number") or "").strip()
        content = (msg.get("content") or "").strip()
        if len(content) > MAX_MESSAGE_CHARS:
            content = content[:MAX_MESSAGE_CHARS] + "\n…[truncated]"
        parts.append(f"[{num}] {role_label.upper()}:\n{content}")
    return "\n\n".join(parts)


def _extract_json(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("empty model response")
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if fence:
        raw = fence.group(1).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        raw = raw[start : end + 1]
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("response is not a JSON object")
    return data


def _validate_label(row: dict[str, Any], conv: dict[str, Any]) -> Optional[dict[str, Any]]:
    num = str(row.get("message_number") or "").strip()
    role = str(row.get("role") or "").strip().lower()
    if role in {"assistant"}:
        role = "bot"
    if not num or role not in {"user", "bot"}:
        return None
    allowed = set(codes_for_role(role))
    code = str(row.get("code") or "").strip().lower()
    if not code or code not in allowed:
        return None
    iterative = bool(row.get("iterative")) and role == "user"
    if iterative and "iterative" not in set(extras_for_role(role)):
        iterative = False
    required = labelable_message_numbers(conv)
    if num not in required:
        return None
    return {
        "message_number": num,
        "role": role,
        "code": code,
        "iterative": iterative,
        "rationale": str(row.get("rationale") or "").strip(),
    }


def call_sonnet(system_prompt: str, user_prompt: str) -> tuple[str, dict[str, int]]:
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    try:
        import anthropic
    except ImportError as err:
        raise RuntimeError("Install anthropic: pip install anthropic") from err

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model_name(),
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    text_parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text_parts.append(block.text)
    text = "\n".join(text_parts).strip()

    usage = {
        "input_tokens": int(getattr(response.usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(response.usage, "output_tokens", 0) or 0),
    }
    return text, usage


def label_conversation(conv: dict[str, Any], *, system_prompt: Optional[str] = None) -> dict[str, Any]:
    book = get_codebook()
    sys_prompt = (system_prompt or book.get("system_prompt") or "").strip()
    user_prompt = TASK_INSTRUCTION + "\n\n" + format_conversation_block(conv)
    raw, usage = call_sonnet(sys_prompt, user_prompt)
    parsed = _extract_json(raw)
    labels_raw = parsed.get("labels")
    if not isinstance(labels_raw, list):
        raise ValueError("response missing labels array")

    validated: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row in labels_raw:
        if not isinstance(row, dict):
            continue
        item = _validate_label(row, conv)
        if not item:
            continue
        key = (item["message_number"], item["role"])
        if key in seen:
            continue
        seen.add(key)
        validated.append(item)

    cid = str(conv.get("conv_id") or conv.get("id") or "").strip()
    saved = 0
    for item in validated:
        upsert_editor_label(
            cid,
            item["message_number"],
            editor=AI_EDITOR,
            role=item["role"],
            code=item["code"],
            rationale=item["rationale"],
            iterative=item["iterative"],
        )
        saved += 1

    required = labelable_message_numbers(conv)
    missing = sorted(required - {x["message_number"] for x in validated})
    return {
        "conv_id": cid,
        "saved": saved,
        "required": len(required),
        "missing": missing,
        "usage": usage,
    }


def _conversation_needs_labeling(conv: dict[str, Any], editor: str = AI_EDITOR) -> bool:
    cid = str(conv.get("conv_id") or conv.get("id") or "").strip()
    required = labelable_message_numbers(conv)
    if not required:
        return False
    labels = load_message_labels(force=True)
    for mid in required:
        key = message_key(cid, mid)
        row = (labels.get(key) or {}).get("by", {}).get(editor)
        if not row or not (row.get("code") or "").strip():
            return True
    return False


def preview_labeling() -> dict[str, Any]:
    conversations = load_conversations()
    pending = [c for c in conversations if _conversation_needs_labeling(c)]
    msg_count = sum(len(labelable_message_numbers(c)) for c in pending)
    est_input = 0
    est_output = 0
    codebook = get_codebook()
    codebook_tokens = _chars_to_tokens(len(codebook.get("system_prompt") or ""))
    for conv in pending:
        block = format_conversation_block(conv)
        est_input += codebook_tokens + _chars_to_tokens(len(TASK_INSTRUCTION) + len(block))
        est_output += len(labelable_message_numbers(conv)) * 80
    est_usd = (
        est_input / 1_000_000 * INPUT_USD_PER_MTOK
        + est_output / 1_000_000 * OUTPUT_USD_PER_MTOK
    )
    return {
        "api_key_configured": api_key_configured(),
        "model": model_name(),
        "editor": AI_EDITOR,
        "total_conversations": len(conversations),
        "pending_conversations": len(pending),
        "pending_messages": msg_count,
        "estimated_input_tokens": est_input,
        "estimated_output_tokens": est_output,
        "estimated_usd": round(est_usd, 2),
    }


def run_labeling_batch(
    *,
    batch_size: int = 3,
    skip_labeled: bool = True,
) -> dict[str, Any]:
    if not api_key_configured():
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    conversations = load_conversations()
    if skip_labeled:
        conversations = [c for c in conversations if _conversation_needs_labeling(c)]

    batch = conversations[: max(1, min(batch_size, 20))]
    results: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    usage_total = {"input_tokens": 0, "output_tokens": 0}

    for conv in batch:
        cid = str(conv.get("conv_id") or conv.get("id") or "").strip()
        try:
            result = label_conversation(conv)
            results.append(result)
            for k in usage_total:
                usage_total[k] += int(result.get("usage", {}).get(k) or 0)
            save_message_labels()
        except Exception as err:  # noqa: BLE001
            logger.exception("AI labeling failed for conv %s", cid)
            errors.append({"conv_id": cid, "error": str(err)})

    remaining = max(0, len(conversations) - len(batch))
    cost_usd = round(
        usage_total["input_tokens"] / 1_000_000 * INPUT_USD_PER_MTOK
        + usage_total["output_tokens"] / 1_000_000 * OUTPUT_USD_PER_MTOK,
        4,
    )
    return {
        "processed": len(batch),
        "labeled": len(results),
        "failed": len(errors),
        "remaining": remaining,
        "done": remaining == 0,
        "results": results,
        "errors": errors,
        "usage": usage_total,
        "cost_usd": cost_usd,
        "finished_at": _now_iso(),
    }
