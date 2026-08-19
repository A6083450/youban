from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any


_SKILLS_DIR = Path(__file__).resolve().parent.parent / "skills"


@lru_cache(maxsize=16)
def load_skill_manifest(skill_name: str) -> dict[str, Any]:
    if not skill_name or any(part in skill_name for part in ("/", "\\", "..")):
        raise ValueError("Skill name is invalid")
    path = _SKILLS_DIR / skill_name / "manifest.json"
    with path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("name") != skill_name:
        raise ValueError(f"Skill manifest name mismatch: {skill_name}")
    if not isinstance(manifest.get("allowed_commands"), list):
        raise ValueError(f"Skill manifest allowed_commands is invalid: {skill_name}")
    return manifest


def require_allowed_command(skill_name: str, command: str) -> dict[str, Any]:
    manifest = load_skill_manifest(skill_name)
    if command not in manifest["allowed_commands"]:
        raise ValueError(f"Skill {skill_name} does not allow command {command}")
    return manifest
