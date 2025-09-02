# ingest/maint.py
from __future__ import annotations

import time
import csv
import sys
import argparse
from typing import Iterable, Optional

from sqlalchemy import select, exists, and_
from sqlalchemy.orm import Session

from db.engine import session_scope
from db.models import Species, SpeciesName
from db.services.names import upsert_names_for_species  # unified PubChem→Cactus→OPSIN
from db.utils import _human_time, _progress_line
from shutil import get_terminal_size

# import your existing task functions
from db.backfill.backfill import (  # rename your current file to backfill_current.py
    relabel_all,
    backfill_atom_maps,
    backfill_missing_G298,
)

# ---------- Shared helpers ----------


def iter_species(
    db: Session,
    only_missing: bool = False,
    only_missing_primary: bool = False,
    start_id: Optional[int] = None,
    limit: Optional[int] = None,
) -> Iterable[Species]:
    q = select(Species)
    if start_id:
        q = q.where(Species.species_id >= start_id)
    if only_missing:
        q = q.where(~exists().where(SpeciesName.species_id == Species.species_id))
    if only_missing_primary:
        q = q.where(exists().where(SpeciesName.species_id == Species.species_id)).where(
            ~exists().where(
                and_(
                    SpeciesName.species_id == Species.species_id,
                    SpeciesName.is_primary.is_(True),
                )
            )
        )
    q = q.order_by(Species.species_id.asc())
    if limit:
        q = q.limit(limit)
    for sp in db.execute(q).scalars():
        yield sp


# ---------- Subcommands ----------


def cmd_relabel(args: argparse.Namespace) -> None:
    relabel_all()
    print("Relabeled wells/isosets across all species/LoTs.")


def cmd_atom_maps(args: argparse.Namespace) -> None:
    backfill_atom_maps(dry_run=args.dry_run)


def cmd_g298(args: argparse.Namespace) -> None:
    n = backfill_missing_G298(
        T=args.T, prefer_user=not args.override_user, write_meta=True
    )
    print(f"Updated G298 for {n} conformers")


def cmd_names(args):
    start_ts = time.monotonic()

    with session_scope() as db:
        # build target list once so we know 'total'
        targets = []
        if getattr(args, "ids", None):
            ids = [int(x) for x in args.ids.split(",") if x.strip()]
            targets = [db.get(Species, sid) for sid in ids]
            targets = [t for t in targets if t is not None]
        else:
            targets = list(
                iter_species(
                    db,
                    only_missing=args.only_missing,
                    only_missing_primary=args.only_missing_primary,
                    start_id=args.start_id,
                    limit=args.limit,
                )
            )

        total = len(targets)
        if total == 0:
            print("[names] nothing to do")
            return

        # counters
        done = 0
        added_total = 0
        primary_changes = 0
        failures = 0

        # print a preflight line
        print(f"[names] will process {total} species")

    # worker function uses its own session
    def _process_one(spc: Species):
        try:
            with session_scope() as db2:
                spc2 = db2.get(Species, spc.species_id)
                rep = upsert_names_for_species(
                    db2,
                    spc2,
                    trace=getattr(args, "trace", False),
                    budget_s=getattr(args, "budget_s", 45.0),
                    # enable_cactus / enable_pubchem flags if you added them:
                    # enable_cactus=not getattr(args, "no_cactus", False),
                    # enable_pubchem=not getattr(args, "no_pubchem", False),
                )
                db2.commit()
                return spc2.species_id, rep, None
        except Exception as e:
            return spc.species_id, None, e

    # sequential or threaded
    workers = max(1, getattr(args, "workers", 1))

    if workers == 1:
        for spc in targets:
            sid, rep, err = _process_one(spc)
            done += 1
            if err:
                failures += 1
                extra = f"sid={sid} ERROR={type(err).__name__}"
            else:
                added_total += int(rep.get("added", 0))
                primary_changes += 1 if rep.get("primary_changed") else 0
                src = rep.get("source_primary") or ""
                reason = rep.get("reason", "")
                extra = f"sid={sid} +{rep.get('added',0)} primary={rep.get('primary_changed',False)} src={src} reason={reason}"
            line = _progress_line(done, total, start_ts, extra)
            # live, single-line update:
            print(
                "\r" + line[: get_terminal_size((100, 20)).columns - 1],
                end="",
                flush=True,
            )
            if getattr(args, "progress", 1) > 0 and (
                done % args.progress == 0 or done == total
            ):
                # also drop a newline snapshot every N, for logs
                print()
            if not getattr(args, "no_sleep", False):
                time.sleep(max(0.0, 1.0 / max(0.1, getattr(args, "rate", 3.0))))
        # final newline if we ended on a carriage return
        if sys.stdout and hasattr(sys.stdout, "isatty") and sys.stdout.isatty():
            print()
    else:
        # parallel path
        from concurrent.futures import ThreadPoolExecutor, as_completed

        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(_process_one, spc) for spc in targets]
            for fut in as_completed(futs):
                sid, rep, err = fut.result()
                done += 1
                if err:
                    failures += 1
                    extra = f"sid={sid} ERROR={type(err).__name__}"
                else:
                    added_total += int(rep.get("added", 0))
                    primary_changes += 1 if rep.get("primary_changed") else 0
                    src = rep.get("source_primary") or ""
                    extra = f"sid={sid} +{rep.get('added',0)} primary={rep.get('primary_changed',False)} src={src}"
                line = _progress_line(done, total, start_ts, extra)
                print(
                    "\r" + line[: get_terminal_size((100, 20)).columns - 1],
                    end="",
                    flush=True,
                )
            print()  # newline at end

    elapsed = time.monotonic() - start_ts
    rate = (done / elapsed * 60.0) if elapsed > 0 else 0.0
    print(
        f"[names] done: {done}/{total} | added={added_total} | primary_changed={primary_changes} | failures={failures}"
    )


# ---------- CLI ----------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="DB maintenance CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    # relabel wells/isosets
    sp = sub.add_parser("relabel", help="Relabel wells/isosets across all species/LoTs")
    sp.set_defaults(func=cmd_relabel)

    # atom maps (uses your existing logic)
    sp = sub.add_parser("atom-maps", help="Backfill atom maps for reactions")
    sp.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be updated without writing",
    )
    sp.set_defaults(func=cmd_atom_maps)

    # G298 fix/compute
    sp = sub.add_parser("g298", help="Compute/normalize G298 where missing")
    sp.add_argument(
        "--T", type=float, default=298.15, help="Temperature in K for G calc"
    )
    sp.add_argument(
        "--override-user",
        action="store_true",
        help="Overwrite existing user G298 values",
    )
    sp.set_defaults(func=cmd_g298)

    # names upsert via services.names
    sp = sub.add_parser("names", help="Fetch & upsert names via PubChem→Cactus→OPSIN")
    sp.add_argument(
        "--only-missing", action="store_true", help="Species with no names at all"
    )
    sp.add_argument(
        "--only-missing-primary",
        action="store_true",
        help="Species that have names but no primary",
    )
    sp.add_argument(
        "--start-id", type=int, default=None, help="Start at species_id ≥ this"
    )
    sp.add_argument("--limit", type=int, default=None, help="Max number of species")
    sp.add_argument(
        "--retries", type=int, default=2, help="Retries per species on transient errors"
    )
    sp.add_argument("--checkpoint", type=str, default=None, help="Write a CSV log here")
    sp.add_argument("--ids", type=str, help="Comma-separated species_ids to process")
    sp.add_argument(
        "--progress",
        type=int,
        default=1,
        help="Print a newline snapshot every N species",
    )
    sp.add_argument(
        "--rate", type=float, default=3.0, help="Politeness sleep rate (species/sec)"
    )
    sp.add_argument("--no-sleep", action="store_true", help="Disable sleep throttle")
    sp.add_argument("--trace", action="store_true", help="Trace external call timings")
    sp.add_argument(
        "--budget-s", type=float, default=45.0, help="Per-species time budget"
    )
    sp.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Number of parallel workers (default 1=sequential)",
    )
    sp.set_defaults(func=cmd_names)

    # “all” convenience runner
    sp = sub.add_parser("all", help="Run relabel → atom-maps → g298 (no names)")
    sp.add_argument("--dry-run", action="store_true")
    sp.add_argument("--T", type=float, default=298.15)

    def _run_all(args):
        cmd_relabel(args)
        cmd_atom_maps(args)
        args2 = argparse.Namespace(T=args.T, override_user=False)
        cmd_g298(args2)

    sp.set_defaults(func=_run_all)

    return p


def main():
    p = build_parser()
    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
