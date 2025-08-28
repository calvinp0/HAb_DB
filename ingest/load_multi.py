from __future__ import annotations

import argparse
import traceback
import os
from pathlib import Path
import time
from typing import List, Iterable

from ingest.load_all import load_all

SDF_EXTS = {".sdf", ".sd"}


def find_sdfs(path: Path, recursive: bool, pattern: str | None) -> List[Path]:
    """Find all SDF files in the given path."""
    if path.is_file():
        return [path]
    if not path.is_dir():
        raise ValueError(f"Path {path} is neither a file nor a directory.")
    if pattern:
        globber = path.rglob if recursive else path.glob
        return [p for p in globber(pattern) if p.is_file()]
    # default: any *.sdf or *.sd file
    globber = path.rglob if recursive else path.glob
    out: List[Path] = []
    for ext in SDF_EXTS:
        out.extend(globber(f"*{ext}"))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser(
        description="Load a directory of SDF files into the database (or a single SDF file)."
    )
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--sdf", type=Path, help="Single SDF file")
    src.add_argument("--sdf-dir", type=Path, help="Directory containing SDFs")

    ap.add_argument("--recursive", action="store_true", help="Recurse into subdirs")
    ap.add_argument(
        "--pattern", help="Glob pattern (e.g., '*.sdf'). Overrides default *.sdf,*.sd"
    )
    ap.add_argument("--csv", type=Path, help="Optional atom-features CSV")
    ap.add_argument("--kinetics-csv", type=Path, help="Optional Arrhenius CSV")
    ap.add_argument(
        "--source-label",
        required=True,
        help="Label for ingest_batch (reused if --reuse-batch)",
    )
    ap.add_argument(
        "--reuse-batch",
        action="store_true",
        help="Reuse a single ingest_batch across all files",
    )
    ap.add_argument(
        "--mirror-geom-from-csv",
        action="store_true",
        help="Insert CSV path/angle/dihedral to Geom* tables",
    )
    ap.add_argument(
        "--csv-angles-are-deg",
        action="store_true",
        help="CSV angles/dihedrals are degrees (default radians)",
    )
    ap.add_argument(
        "--dry-run", action="store_true", help="Parse & validate only; no DB writes"
    )
    # Bind “no-” flags directly to the target booleans
    ap.add_argument(
        "--no-strict-roles",
        dest="strict_roles",
        action="store_false",
        help="Disable strict role enforcement (fallback to positional order)",
    )
    ap.add_argument(
        "--no-sanitize",
        dest="sanitize",
        action="store_false",
        help="Disable RDKit sanitization when extracting XYZ",
    )

    ap.add_argument(
        "--stop-on-error",
        action="store_true",
        help="Abort on first file error (default: best-effort)",
    )

    ap.add_argument(
        "--no-skip-if-loaded",
        dest="skip_if_loaded",
        action="store_false",
        help="Do not skip previously loaded reactions",
    )
    ap.set_defaults(skip_if_loaded=True)

    # Defaults: strict_roles=True, sanitize=True unless the flags are provided
    ap.set_defaults(strict_roles=True, sanitize=True)

    args = ap.parse_args()

    # Resolve files
    if args.sdf:
        sdf_files = [args.sdf]
    else:
        sdf_files = find_sdfs(
            args.sdf_dir, recursive=args.recursive, pattern=args.pattern
        )

    if not sdf_files:
        print("No SDF files found.")
        return

    print(f"Discovered {len(sdf_files)} SDF(s) to process.")
    if args.reuse_batch:
        print(
            f"Reusing/creating a single ingest_batch with source_label='{args.source_label}'"
        )

    errors = 0
    durations = []
    skipped = 0
    for i, sdf in enumerate(sdf_files, start=1):
        print(f"[{i}/{len(sdf_files)}] Loading: {sdf}")
        t0 = time.perf_counter()
        try:
            load_all(
                sdf_path=sdf,
                source_label=args.source_label,
                csv_path=args.csv,
                mirror_geom_from_csv=args.mirror_geom_from_csv,
                csv_angles_are_deg=args.csv_angles_are_deg,
                strict_roles=args.strict_roles,
                sanitize=args.sanitize,
                kinetics_csv=args.kinetics_csv,
                reuse_batch=args.reuse_batch,
                skip_if_loaded=args.skip_if_loaded,
                dry_run=args.dry_run,
            )
            dt = time.perf_counter() - t0
            durations.append(dt)
            print(f"  ✓ Done in {dt:.2f}s")
        except Exception as e:
            if "already loaded; skipping." in str(e).lower():  # optional, if you raise
                skipped += 1
            else:
                errors += 1
                print(f"  ✗ Error: {e}")
                traceback.print_exc()
            if args.stop_on_error:
                raise

    total = len(sdf_files)
    ok = total - errors
    total_time = sum(durations) or 1e-9
    print(
        f"Done. Loaded {ok} ok, {errors} failed. Avg {ok/total_time:.2f} files/sec (skipped: {skipped})"
    )


if __name__ == "__main__":
    main()
