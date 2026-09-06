#!/usr/bin/env python3
"""
parse_libraries.py — Normalize the three reference libraries under
content/babu-memoir/_system/ (clinic-library.txt, quotes-library.txt,
incident-bank.md) into one JSON file the journal site can browse and use as
AI grounding context.

    python3 scripts/memoir/parse_libraries.py

Writes content/babu-memoir/_system/_generated/library.json. Re-run after
editing any of the three source files, then run scripts/site/sync_library.sh
to mirror the output into the site build — this script does not touch site/.
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SYSTEM_DIR = os.path.join(ROOT, "content", "babu-memoir", "_system")
OUT_DIR = os.path.join(SYSTEM_DIR, "_generated")
OUT_PATH = os.path.join(OUT_DIR, "library.json")

ENTRY_HEADER_RE = re.compile(r"^\[(?P<id>[A-Z]+-\d+)\](?P<rest>.*)$")
LABELED_FIELD_RE = re.compile(
    r"^(Source screenshot|Source|Original text|Attribution style|Theme tags|"
    r"Best fit|Used in|Notes|Title|Era|Themes|Emotional arc|Status|Told in|"
    r"Refs|Connections|Takeaway):\s?(.*)$"
)


def read(name):
    with open(os.path.join(SYSTEM_DIR, name), encoding="utf-8") as f:
        return f.read()


def split_entries(text, id_prefix):
    """Find every `[PREFIX-###...]` header and return (id, header_rest, body)
    for the text between one header and the next."""
    lines = text.splitlines()
    starts = []
    for i, line in enumerate(lines):
        m = ENTRY_HEADER_RE.match(line)
        if m and m.group("id").startswith(id_prefix + "-"):
            starts.append((i, m.group("id"), m.group("rest").strip()))
    entries = []
    for idx, (line_no, entry_id, rest) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        body = "\n".join(lines[line_no + 1 : end]).strip("\n")
        entries.append({"id": entry_id, "header_suffix": rest, "raw": body})
    return entries


def parse_labeled_fields(body):
    """Split a body into {label: value} using the LABELED_FIELD_RE labels.
    A label's value continues across subsequent lines until the next
    recognized label — this tolerates the multi-paragraph Original text/Notes
    fields in quotes-library.txt."""
    fields = {}
    current = None
    buf = []
    for line in body.splitlines():
        m = LABELED_FIELD_RE.match(line)
        if m:
            if current is not None:
                fields[current] = "\n".join(buf).strip()
            current = m.group(1)
            buf = [m.group(2)]
        elif current is not None:
            buf.append(line)
    if current is not None:
        fields[current] = "\n".join(buf).strip()
    return fields


def parse_incident_bank():
    text = read("incident-bank.md")
    # Chapter sections are delimited by a `======` banner line, a title line,
    # another `======` banner, e.g. "CHAPTER 3 — ... [ACTIVE]".
    section_re = re.compile(
        r"={10,}\n(?P<title>[^\n]+)\n={10,}", re.MULTILINE
    )
    sections = [(m.start(), m.end(), m.group("title").strip()) for m in section_re.finditer(text)]

    def section_for(pos):
        current = None
        for start, end, title in sections:
            if start <= pos:
                current = title
            else:
                break
        return current

    incidents = []
    for entry in split_entries(text, "INC"):
        fields = parse_labeled_fields(entry["raw"])
        # Locate this entry's chapter section by its header position in the source text.
        pos = text.find(f"[{entry['id']}]")
        incidents.append(
            {
                "id": entry["id"],
                "kind": "incident",
                "title": fields.get("Title", ""),
                "section": section_for(pos),
                "fields": {
                    "era": fields.get("Era", ""),
                    "themes": fields.get("Themes", ""),
                    "emotional_arc": fields.get("Emotional arc", ""),
                    "status": fields.get("Status", ""),
                    "told_in": fields.get("Told in", ""),
                    "refs": fields.get("Refs", ""),
                    "connections": fields.get("Connections", ""),
                    "takeaway": fields.get("Takeaway", ""),
                },
                "raw": entry["raw"],
            }
        )
    return incidents


def parse_quotes_library():
    text = read("quotes-library.txt")
    quotes, reflections = [], []
    for prefix, bucket, kind in (("QUOTE", quotes, "quote"), ("REFLECT", reflections, "reflection")):
        for entry in split_entries(text, prefix):
            fields = parse_labeled_fields(entry["raw"])
            bucket.append(
                {
                    "id": entry["id"],
                    "kind": kind,
                    "title": (fields.get("Original text", "") or "")[:80].strip(),
                    "fields": {
                        "source": fields.get("Source screenshot") or fields.get("Source", ""),
                        "original_text": fields.get("Original text", ""),
                        "attribution_style": fields.get("Attribution style", ""),
                        "theme_tags": fields.get("Theme tags", ""),
                        "best_fit": fields.get("Best fit", ""),
                        "used_in": fields.get("Used in", ""),
                        "notes": fields.get("Notes", ""),
                    },
                    "reclassified": "RECLASSIFIED" in entry["header_suffix"],
                    "raw": entry["raw"],
                }
            )
    return quotes, reflections


def parse_clinic_library():
    text = read("clinic-library.txt")

    conditions = []
    for entry in split_entries(text, "COND"):
        name_line = entry["header_suffix"].strip()
        signs = {}
        current = None
        for line in entry["raw"].splitlines():
            stripped = line.strip()
            if stripped.endswith(":") and stripped.isupper():
                current = stripped.rstrip(":")
                signs[current] = []
            elif stripped.startswith("- ") and current:
                signs[current].append(stripped[2:])
            elif stripped.startswith("Source:"):
                pass  # captured via raw; not surfaced as a separate field
        conditions.append(
            {
                "id": entry["id"],
                "kind": "condition",
                "title": name_line,
                "fields": {"signs": signs},
                "raw": entry["raw"],
            }
        )

    characters = []
    for entry in split_entries(text, "CHAR"):
        name_line = entry["header_suffix"].strip()
        # Per-condition sub-blocks look like "  ADHD — STRONG" headers within
        # the entry body, each with Evidence bullets and a Narrative angle/Note.
        subblock_re = re.compile(
            r"^  (?P<condition>[A-Z /]+)\s+—\s+(?P<confidence>STRONG|MODERATE|SPECULATIVE)\s*$",
            re.MULTILINE,
        )
        raw = entry["raw"]
        matches = list(subblock_re.finditer(raw))
        conditions_map = []
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(raw)
            block = raw[m.end() : end]
            evidence = re.findall(r"^\s*- (.+)$", block, re.MULTILINE)
            narrative = ""
            nm = re.search(r"Narrative angle:\s?(.+?)(?=\n\s*\n|\Z)", block, re.DOTALL)
            if nm:
                narrative = nm.group(1).strip()
            note = ""
            note_m = re.search(r"Note:\s?(.+?)(?=\n\s*\n|\Z)", block, re.DOTALL)
            if note_m:
                note = note_m.group(1).strip()
            conditions_map.append(
                {
                    "condition": m.group("condition").strip(),
                    "confidence": m.group("confidence"),
                    "evidence": evidence,
                    "narrative_angle": narrative,
                    "note": note,
                }
            )
        characters.append(
            {
                "id": entry["id"],
                "kind": "character",
                "title": name_line,
                "fields": {"conditions": conditions_map},
                "raw": raw,
            }
        )

    return conditions, characters


def main():
    conditions, characters = parse_clinic_library()
    quotes, reflections = parse_quotes_library()
    incidents = parse_incident_bank()

    library = {
        "conditions": conditions,
        "characters": characters,
        "quotes": quotes,
        "reflections": reflections,
        "incidents": incidents,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(library, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Wrote {OUT_PATH}")
    for k, v in library.items():
        print(f"  {k}: {len(v)}")


if __name__ == "__main__":
    main()
