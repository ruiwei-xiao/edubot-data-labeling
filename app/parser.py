from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import pdfplumber

WELCOME_TITLE_RE = re.compile(r"^Welcome to (.+?)!\s*Are you ready", re.I | re.S)
TIMESTAMP_RE = re.compile(
    r"^([A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2} [AP]M)"
    r"\s*•\s*⏱\s*(\d{1,2}:\d{2}:\d{2})\s*$"
)
PAGE_MARKER_RE = re.compile(r"^--\s*\d+\s+of\s+\d+\s*--\s*$")
TOOL_METADATA_RE = re.compile(r"^[a-z].*\(\d+\s+tools?\)\s*$", re.I)
BOT_PATTERNS = [
    re.compile(r"^Welcome to .+! Are you ready", re.I),
    re.compile(r"^Thesis:\s*\d+/\d+", re.I),
    re.compile(r"^Based on the rubric", re.I),
    re.compile(r"^Evidence & Commentary:", re.I),
    re.compile(r"^Great question", re.I),
    re.compile(r"^You're asking", re.I),
    re.compile(r"^Rather than giving you", re.I),
]

SHEET_HEADERS = [
    "conversation_id",
    "User",
    "Conversation",
    "Msg #",
    "Timestamp",
    "Elapsed",
    "Role",
    "Message",
]


@dataclass
class Message:
    msg_num: int
    timestamp: str
    elapsed: str
    role: str
    message: str


@dataclass
class Conversation:
    conversation_id: str
    title: str
    user: str = "anonymous"
    messages: list[Message] = field(default_factory=list)
    source_file: str = ""
    meta_date: str = ""

    @property
    def message_count(self) -> int:
        return len(self.messages)

    @property
    def date_display(self) -> str:
        if self.meta_date:
            return self.meta_date
        if not self.messages:
            return ""
        try:
            dt = datetime.strptime(self.messages[0].timestamp, "%b %d, %Y, %I:%M:%S %p")
            return f"{dt.month}/{dt.day}/{dt.year}"
        except ValueError:
            return self.messages[0].timestamp.split(",")[0]

    def to_sheet_rows(self) -> list[list[str]]:
        rows = []
        for msg in self.messages:
            rows.append([
                self.conversation_id,
                self.user,
                self.title,
                str(msg.msg_num),
                msg.timestamp,
                msg.elapsed,
                msg.role,
                msg.message,
            ])
        return rows


def extract_text_from_pdf(pdf_path: str | Path) -> str:
    lines: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for line in text.splitlines():
                stripped = line.strip()
                if stripped:
                    lines.append(stripped)
    return "\n".join(lines)


def conversation_id_from_filename(filename: str) -> str:
    match = re.search(r"Conversation[_\s]*(\d+)", filename, re.I)
    if match:
        return f"conv_{int(match.group(1)):03d}"
    stem = Path(filename).stem
    return f"conv_{stem[:20].lower().replace(' ', '_')}"


def _clean_message_lines(lines: list[str]) -> str:
    cleaned = [ln for ln in lines if not TOOL_METADATA_RE.match(ln.strip())]
    return "\n".join(cleaned).strip()


def _looks_like_bot(message: str) -> bool:
    return any(p.search(message.strip()) for p in BOT_PATTERNS)


def _assign_roles(messages: list[dict]) -> None:
    if not messages:
        return

    def text_of(m: dict) -> str:
        return "\n".join(m["message_lines"]).strip()

    if _looks_like_bot(text_of(messages[0])):
        roles = ["Bot", "Student"] * ((len(messages) // 2) + 1)
    else:
        roles = ["Student", "Bot"] * ((len(messages) // 2) + 1)

    for i, msg in enumerate(messages):
        heuristic = "Bot" if _looks_like_bot(text_of(msg)) else "Student"
        alternating = roles[i]
        msg["role"] = heuristic if heuristic == alternating else alternating


def parse_playlab_pdf(pdf_path: str | Path, user: str = "anonymous") -> Conversation:
    pdf_path = Path(pdf_path)
    raw_text = extract_text_from_pdf(pdf_path)
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]

    conversation_id = conversation_id_from_filename(pdf_path.name)
    title = "Untitled Conversation"
    start_idx = 0

    if lines and not TIMESTAMP_RE.match(lines[0]):
        title = lines[0]
        start_idx = 1

    raw_messages: list[dict] = []
    current: dict | None = None

    for line in lines[start_idx:]:
        if PAGE_MARKER_RE.match(line):
            continue

        ts_match = TIMESTAMP_RE.match(line)
        if ts_match:
            if current:
                raw_messages.append(current)
            current = {
                "timestamp": ts_match.group(1),
                "elapsed": ts_match.group(2),
                "message_lines": [],
            }
            continue

        if current is not None:
            current["message_lines"].append(line)

    if current:
        raw_messages.append(current)

    _assign_roles(raw_messages)

    messages = [
        Message(
            msg_num=i + 1,
            timestamp=m["timestamp"],
            elapsed=m["elapsed"],
            role=m["role"],
            message=_clean_message_lines(m["message_lines"]),
        )
        for i, m in enumerate(raw_messages)
    ]

    if title == "Untitled Conversation" and messages:
        welcome = WELCOME_TITLE_RE.search(messages[0].message)
        if welcome:
            title = welcome.group(1).strip()

    return Conversation(
        conversation_id=conversation_id,
        title=title,
        user=user,
        messages=messages,
        source_file=pdf_path.name,
    )


def parse_multiple_pdfs(
    pdf_paths: list[str | Path], user: str = "anonymous"
) -> list[Conversation]:
    conversations = []
    for path in pdf_paths:
        conversations.append(parse_playlab_pdf(path, user=user))
    return conversations


def _conversation_sort_key(conv: Conversation) -> tuple:
    match = re.search(r"(\d+)", conv.conversation_id)
    return (int(match.group(1)) if match else 0, conv.conversation_id)


def all_sheet_rows(conversations: list[Conversation]) -> list[list[str]]:
    rows = [SHEET_HEADERS.copy()]
    for conv in sorted(conversations, key=_conversation_sort_key):
        rows.extend(conv.to_sheet_rows())
    return rows
