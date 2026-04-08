#!/usr/bin/env python3
"""Compare a Supabase SQL editor schema export against database/schema.sql."""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _extract_markdown_table_cells(text: str) -> list[str]:
    cells: list[str] = []
    current: list[str] | None = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line:
            if current is not None:
                current.append("")
            continue
        if line.startswith("| ddl") or re.fullmatch(r"\|\s*-+\s*\|", line):
            continue

        if line.startswith("| "):
            if current is not None:
                cells.append("\n".join(current).rstrip())
            current = [line[2:]]
        elif current is not None:
            current.append(line)

        if current is not None and current[-1].rstrip().endswith("|"):
            current[-1] = re.sub(r"\s*\|\s*$", "", current[-1])
            cells.append("\n".join(current).rstrip())
            current = None

    if current is not None:
        cells.append("\n".join(current).rstrip())
    return [cell for cell in cells if cell.strip()]


def _statement_blocks(text: str) -> list[str]:
    raw = text.strip()
    if not raw:
        return []

    if raw.startswith("| ddl"):
        chunks = _extract_markdown_table_cells(raw)
        return [_clean_statement(chunk) for chunk in chunks if _clean_statement(chunk)]

    parts = re.split(r";\s*(?:\n|$)", raw)
    statements = []
    for part in parts:
        cleaned = _clean_statement(part)
        if cleaned:
            statements.append(f"{cleaned};")
    return statements


def _clean_statement(stmt: str) -> str:
    stmt = stmt.replace("\\n", "\n").replace("\\t", "\t").strip()
    stmt = re.sub(r"[ \t]+\n", "\n", stmt)
    stmt = re.sub(r"\n{3,}", "\n\n", stmt)
    return stmt


def _canonical_key(stmt: str) -> str:
    return re.sub(r"\s+", " ", stmt.strip().rstrip(";")).lower()


def _normalize(path: Path) -> dict[str, str]:
    statements = _statement_blocks(_read_text(path))
    normalized: dict[str, str] = {}
    for stmt in statements:
        normalized[_canonical_key(stmt)] = stmt
    return normalized


def _print_section(title: str, statements: list[str]) -> None:
    print(title)
    if not statements:
        print("  none")
        return
    for stmt in statements:
        print()
        print(stmt)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare a Supabase SQL editor export against the repo schema snapshot."
    )
    parser.add_argument(
        "remote_export",
        type=Path,
        help="Path to the saved output from database/sql_editor_schema_export.sql",
    )
    parser.add_argument(
        "repo_schema",
        nargs="?",
        type=Path,
        default=Path("database/schema.sql"),
        help="Path to the repo schema snapshot (default: database/schema.sql)",
    )
    parser.add_argument(
        "--diff",
        action="store_true",
        help="Also print a unified diff of the normalized statement lists.",
    )
    args = parser.parse_args()

    repo = _normalize(args.repo_schema)
    remote = _normalize(args.remote_export)

    missing_in_remote = sorted(
        (repo[key] for key in repo.keys() - remote.keys()),
        key=_canonical_key,
    )
    extra_in_remote = sorted(
        (remote[key] for key in remote.keys() - repo.keys()),
        key=_canonical_key,
    )

    print(f"repo statements:   {len(repo)}")
    print(f"remote statements: {len(remote)}")
    print(f"missing in remote: {len(missing_in_remote)}")
    print(f"extra in remote:   {len(extra_in_remote)}")
    print()

    _print_section("Missing In Remote (present in repo schema):", missing_in_remote)
    print()
    _print_section("Extra In Remote (not present in repo schema):", extra_in_remote)

    if args.diff:
        print()
        print("Unified Diff:")
        repo_lines = "\n\n".join(sorted(repo.values(), key=_canonical_key)).splitlines()
        remote_lines = "\n\n".join(sorted(remote.values(), key=_canonical_key)).splitlines()
        for line in difflib.unified_diff(
            repo_lines,
            remote_lines,
            fromfile=str(args.repo_schema),
            tofile=str(args.remote_export),
            lineterm="",
        ):
            print(line)

    return 1 if missing_in_remote or extra_in_remote else 0


if __name__ == "__main__":
    sys.exit(main())
