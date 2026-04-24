"""
Copy SOPs (standards_sops + sop_steps) from the local DB to a target DB.

Typical use:

    # Dry run — prints what would be inserted, no writes.
    LIVE_DATABASE_URL=<url> python3 scripts/push-sops-to-live.py

    # Real run — writes to the target DB.
    LIVE_DATABASE_URL=<url> python3 scripts/push-sops-to-live.py --apply

Behaviour:
  - Reads from postgresql://localhost/tck_planner by default.
  - Targets $LIVE_DATABASE_URL (required).
  - Only copies SOPs tagged "imported:gembadocs".
  - Idempotent: skips any SOP whose ref:<N> tag already exists on the target.
  - Remaps author_id by matching app_users.name (case-insensitive, alphanumeric-only)
    because user IDs usually differ between environments.
  - Preserves step order, image bytes, and mime types.
"""

import os
import re
import sys
from typing import Optional

import psycopg2
import psycopg2.extras


LOCAL_URL = os.environ.get("LOCAL_DATABASE_URL", "postgresql://localhost/tck_planner")
LIVE_URL = os.environ.get("LIVE_DATABASE_URL")
APPLY = "--apply" in sys.argv


def norm(name: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def ref_from_tags(tags):
    for tag in (tags or []):
        if tag.startswith("ref:"):
            return tag.split(":", 1)[1]
    return None


def main():
    if not LIVE_URL:
        print("ERROR: LIVE_DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    local = psycopg2.connect(LOCAL_URL)
    live = psycopg2.connect(LIVE_URL)
    live.autocommit = False

    with local.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as lcur, \
         live.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as tcur:

        # Build author name -> live user id map
        tcur.execute("SELECT id, name FROM app_users")
        live_users_by_norm = {norm(r["name"]): r["id"] for r in tcur.fetchall()}

        # Existing refs on live (skip set)
        tcur.execute("SELECT id, tags FROM standards_sops")
        live_refs = set()
        for row in tcur.fetchall():
            r = ref_from_tags(row.get("tags"))
            if r:
                live_refs.add(r)

        # Local author id -> name (for remapping)
        lcur.execute("SELECT id, name FROM app_users")
        local_users_by_id = {r["id"]: r["name"] for r in lcur.fetchall()}

        # Pull local SOPs tagged imported:gembadocs
        lcur.execute(
            """
            SELECT id, title, stations, tags, author_id
            FROM standards_sops
            WHERE 'imported:gembadocs' = ANY(tags)
            ORDER BY id
            """
        )
        local_sops = lcur.fetchall()

        to_insert = []
        skipped_existing = 0
        for s in local_sops:
            ref = ref_from_tags(s["tags"])
            if ref and ref in live_refs:
                skipped_existing += 1
                continue
            to_insert.append(s)

        print(f"Local SOPs tagged imported:gembadocs : {len(local_sops)}")
        print(f"Skipped (ref already on target)       : {skipped_existing}")
        print(f"Will insert                            : {len(to_insert)}")
        print()

        inserted = 0
        steps_inserted = 0
        authors_unmapped = []

        for s in to_insert:
            # Map author
            live_author_id = None
            if s["author_id"] is not None:
                name = local_users_by_id.get(s["author_id"])
                if name:
                    live_author_id = live_users_by_norm.get(norm(name))
                    if live_author_id is None:
                        authors_unmapped.append((s["id"], s["title"], name))

            # Fetch local steps
            lcur.execute(
                """
                SELECT position, description, image_mime, image_data
                FROM sop_steps
                WHERE sop_id = %s
                ORDER BY position
                """,
                (s["id"],),
            )
            steps = lcur.fetchall()

            print(f"  [local_id={s['id']:3d}] {s['title'][:60]:<60s}  steps={len(steps)}  author={live_author_id or '—'}")

            if not APPLY:
                continue

            tcur.execute(
                """
                INSERT INTO standards_sops (title, stations, tags, author_id)
                VALUES (%s, %s, %s, %s)
                RETURNING id
                """,
                (s["title"], s["stations"], s["tags"], live_author_id),
            )
            new_sop_id = tcur.fetchone()["id"]
            inserted += 1

            for st in steps:
                tcur.execute(
                    """
                    INSERT INTO sop_steps (sop_id, position, description, image_mime, image_data)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (new_sop_id, st["position"], st["description"], st["image_mime"], bytes(st["image_data"]) if st["image_data"] else None),
                )
                steps_inserted += 1

        if APPLY:
            live.commit()
            print(f"\nCommitted. {inserted} SOPs, {steps_inserted} steps inserted on target.")
        else:
            print("\nDry run — no writes. Re-run with --apply to commit.")

        if authors_unmapped:
            print(f"\nAuthors with no match on target ({len(authors_unmapped)}):")
            for sid, title, name in authors_unmapped:
                print(f"  [local_id={sid}] {title[:50]:<50s}  author='{name}'")

    local.close()
    live.close()


if __name__ == "__main__":
    main()
