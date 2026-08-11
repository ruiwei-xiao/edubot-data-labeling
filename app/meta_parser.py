from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

import pytesseract
from PIL import Image

DATE_RE = re.compile(r"(\d{1,2}/\d{1,2}/\d{4})")
COUNT_RE = re.compile(r"\b(\d{1,4})\b")
NAME_RE = re.compile(r"^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+$")
PREFIX_RE = re.compile(r"^[@©®™\s]+")


@dataclass
class MetaEntry:
    title: str
    user: str
    date: str
    message_count: int | None = None

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "user": self.user,
            "date": self.date,
            "message_count": self.message_count,
        }


def _normalize_title(text: str) -> str:
    return re.sub(r"\s+", " ", PREFIX_RE.sub("", text)).strip()


def _normalize_user(text: str) -> str:
    cleaned = PREFIX_RE.sub("", text).strip()
    parts = cleaned.split()
    return " ".join(p.capitalize() for p in parts)


def _title_similarity(a: str, b: str) -> float:
    a_norm = a.lower().strip()
    b_norm = b.lower().strip()
    if a_norm == b_norm:
        return 1.0
    if a_norm in b_norm or b_norm in a_norm:
        return 0.85
    return SequenceMatcher(None, a_norm, b_norm).ratio()


def _ocr_rows(image: Image.Image) -> list[dict[str, str]]:
    img_w, _ = image.size
    data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)

    words: list[dict] = []
    for i, text in enumerate(data["text"]):
        t = text.strip()
        if not t:
            continue
        try:
            conf = int(data["conf"][i])
        except ValueError:
            conf = 0
        if conf < 20:
            continue
        words.append({
            "text": t,
            "y": data["top"][i],
            "cx": data["left"][i] + data["width"][i] / 2,
        })

    words.sort(key=lambda w: (w["y"], w["cx"]))
    mid = img_w * 0.52
    raw_rows: list[dict] = []

    for word in words:
        if not raw_rows or abs(word["y"] - raw_rows[-1]["y"]) > 14:
            raw_rows.append({"y": word["y"], "left": [], "right": []})
        bucket = raw_rows[-1]["left"] if word["cx"] < mid else raw_rows[-1]["right"]
        bucket.append(word)

    rows: list[dict[str, str]] = []
    for row in raw_rows:
        left = " ".join(w["text"] for w in sorted(row["left"], key=lambda w: w["cx"]))
        right = " ".join(w["text"] for w in sorted(row["right"], key=lambda w: w["cx"]))
        if left or right:
            rows.append({"left": left.strip(), "right": right.strip()})
    return rows


def _parse_count(text: str) -> int | None:
    if not text:
        return None
    nums = COUNT_RE.findall(text)
    for num in reversed(nums):
        val = int(num)
        if 1 <= val <= 9999:
            return val
    return None


def _looks_like_user_line(text: str) -> bool:
    cleaned = _normalize_user(text)
    return bool(NAME_RE.match(cleaned)) or (
        len(cleaned.split()) >= 2 and cleaned[0].isalpha()
    )


def parse_meta_screenshot(image_path: str | Path) -> list[MetaEntry]:
    image = Image.open(image_path)
    rows = _ocr_rows(image)
    entries: list[MetaEntry] = []
    i = 0

    while i < len(rows):
        row = rows[i]
        left, right = row["left"], row["right"]
        date_match = DATE_RE.search(right)

        if date_match and left:
            title = _normalize_title(left)
            date = date_match.group(1)
            user = ""
            count = _parse_count(right.replace(date_match.group(1), ""))

            if i + 1 < len(rows) and _looks_like_user_line(rows[i + 1]["left"]):
                user = _normalize_user(rows[i + 1]["left"])
                if count is None:
                    count = _parse_count(rows[i + 1]["right"])
                i += 2
            else:
                i += 1

            if title and user:
                entries.append(MetaEntry(title=title, user=user, date=date, message_count=count))
            continue

        if _looks_like_user_line(left) and i > 0:
            i += 1
            continue

        i += 1

    if not entries:
        entries = _parse_meta_fallback(rows)

    return entries


def _parse_meta_fallback(rows: list[dict[str, str]]) -> list[MetaEntry]:
    """Fallback parser when spatial pairing fails."""
    entries: list[MetaEntry] = []
    pending_title: str | None = None

    for row in rows:
        left, right = row["left"], row["right"]
        date_match = DATE_RE.search(right)

        if date_match and left and not _looks_like_user_line(left):
            pending_title = _normalize_title(left)
            continue

        if pending_title and _looks_like_user_line(left):
            date = date_match.group(1) if date_match else ""
            if not date:
                for r in rows:
                    dm = DATE_RE.search(r["right"])
                    if dm:
                        date = dm.group(1)
                        break
            count = _parse_count(right)
            entries.append(MetaEntry(
                title=pending_title,
                user=_normalize_user(left),
                date=date,
                message_count=count,
            ))
            pending_title = None

    return entries


def _parse_date_parts(date_str: str) -> tuple[int, int, int] | None:
    match = DATE_RE.search(date_str)
    if not match:
        return None
    parts = match.group(1).split("/")
    if len(parts) != 3:
        return None
    month, day, year = (int(p) for p in parts)
    return year, month, day


def _date_similarity(a: str, b: str) -> float:
    pa, pb = _parse_date_parts(a), _parse_date_parts(b)
    if not pa or not pb:
        return 0.0
    if pa == pb:
        return 1.0
    # allow OCR off-by-one on day/month
    if pa[0] == pb[0] and pa[1] == pb[1] and abs(pa[2] - pb[2]) <= 2:
        return 0.8
    if pa[0] == pb[0] and abs(pa[1] - pb[1]) <= 1 and abs(pa[2] - pb[2]) <= 3:
        return 0.6
    return 0.0


def _conversation_sort_key(conv) -> tuple:
    match = re.search(r"(\d+)", conv.conversation_id)
    return (int(match.group(1)) if match else 0, conv.conversation_id)


def _score_meta_match(conv, meta: MetaEntry) -> float:
    score = _title_similarity(conv.title, meta.title)
    score += _date_similarity(conv.date_display, meta.date) * 0.35
    if conv.message_count and meta.message_count:
        if conv.message_count == meta.message_count:
            score += 0.25
        else:
            score -= 0.15
    return score


def match_meta_to_conversations(
    conversations: list,
    meta_entries: list[MetaEntry],
) -> list[dict]:
    """Return list of {conversation_id, meta_index, score} matches."""
    sorted_convs = sorted(conversations, key=_conversation_sort_key)

    if len(sorted_convs) == len(meta_entries) and meta_entries:
        return [
            {
                "conversation_id": conv.conversation_id,
                "meta_index": idx,
                "score": 1.0,
            }
            for idx, conv in enumerate(sorted_convs)
        ]

    used_meta: set[int] = set()
    matches: list[dict] = []

    for conv in sorted_convs:
        best_idx = -1
        best_score = 0.0

        for idx, meta in enumerate(meta_entries):
            if idx in used_meta:
                continue
            score = _score_meta_match(conv, meta)
            if best_score < score:
                best_score = score
                best_idx = idx

        if best_idx >= 0 and best_score >= 0.4:
            used_meta.add(best_idx)
            matches.append({
                "conversation_id": conv.conversation_id,
                "meta_index": best_idx,
                "score": round(best_score, 2),
            })

    unmatched_conv = [
        c for c in sorted_convs
        if c.conversation_id not in {m["conversation_id"] for m in matches}
    ]
    unused_meta = [i for i in range(len(meta_entries)) if i not in used_meta]

    for conv, meta_idx in zip(unmatched_conv, unused_meta):
        matches.append({
            "conversation_id": conv.conversation_id,
            "meta_index": meta_idx,
            "score": 0.0,
        })

    return matches


def apply_meta_to_conversation(conv, meta: MetaEntry) -> None:
    conv.title = meta.title
    conv.user = meta.user
    conv.meta_date = meta.date


def reapply_meta_for_conversation(conv, meta_entries: list[MetaEntry], all_conversations: list) -> bool:
    if not meta_entries:
        return False
    matches = match_meta_to_conversations(all_conversations, meta_entries)
    match = next((m for m in matches if m["conversation_id"] == conv.conversation_id), None)
    if not match:
        return False
    apply_meta_to_conversation(conv, meta_entries[match["meta_index"]])
    return True


def apply_meta_to_conversations(conversations: list, meta_entries: list[MetaEntry]) -> list[dict]:
    matches = match_meta_to_conversations(conversations, meta_entries)
    match_map = {m["conversation_id"]: m for m in matches}
    applied: list[dict] = []

    for conv in conversations:
        match = match_map.get(conv.conversation_id)
        if not match:
            continue
        meta = meta_entries[match["meta_index"]]
        apply_meta_to_conversation(conv, meta)
        applied.append({
            "conversation_id": conv.conversation_id,
            "source_file": conv.source_file,
            "meta": meta.to_dict(),
            "match_score": match["score"],
        })

    return applied
