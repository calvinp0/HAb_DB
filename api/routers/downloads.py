from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from ingest.export_reactions import export_reactions

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.get("/reactions.zip", response_class=FileResponse)
def download_reaction_export(background_tasks: BackgroundTasks):
    """Generate a fresh export bundle and stream it as a ZIP."""

    tmp_root = Path(tempfile.mkdtemp(prefix="hab_export_"))
    bundle_dir = tmp_root / "bundle"
    try:
        export_reactions(bundle_dir)
        archive_base = tmp_root / "hab_reactions_export"
        archive_path = Path(
            shutil.make_archive(str(archive_base), "zip", root_dir=bundle_dir)
        )
    except Exception as exc:  # pragma: no cover - defensive
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Export failed: {exc}")

    background_tasks.add_task(shutil.rmtree, tmp_root)
    return FileResponse(
        path=archive_path,
        filename="hab_reactions_export.zip",
        media_type="application/zip",
    )
