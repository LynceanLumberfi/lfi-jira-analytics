from __future__ import annotations

from typing import Any


_BLOCK_TYPES = {
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "listItem",
    "codeBlock",
    "blockquote",
    "rule",
}


def adf_to_text(adf: Any) -> str | None:
    """Flatten an Atlassian Document Format node tree into plain text."""

    if not adf or not isinstance(adf, dict):
        return None

    parts: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                walk(child)
            return
        if not isinstance(node, dict):
            return
        node_type = node.get("type")
        if node_type == "text" and node.get("text"):
            parts.append(node["text"])
        elif node_type == "hardBreak":
            parts.append("\n")
        for child in node.get("content") or []:
            walk(child)
        if node_type in _BLOCK_TYPES:
            parts.append("\n")

    walk(adf)
    text = "".join(parts).strip()
    return text or None
