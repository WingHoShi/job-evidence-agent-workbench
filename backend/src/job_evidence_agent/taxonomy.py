"""一期固定的 AI 应用开发能力词典。"""

CAPABILITY_TERMS = {
    "fastapi": ("fastapi",),
    "docker": ("docker", "docker compose"),
    "python": ("python",),
    "react": ("react",),
    "typescript": ("typescript", "typescript"),
    "rag": ("rag", "检索增强"),
    "langgraph": ("langgraph",),
}


def capability_tags(text: str) -> tuple[str, ...]:
    normalized = text.lower()
    return tuple(tag for tag, terms in CAPABILITY_TERMS.items() if any(term in normalized for term in terms))
