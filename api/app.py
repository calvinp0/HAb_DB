# api/app.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from api.routers import species, conformers

app = FastAPI(title="HAbstraction API")

# CORS (dev-friendly)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- API under /api ----
app.include_router(species.router, prefix="/api")
app.include_router(conformers.species_scoped, prefix="/api")
app.include_router(conformers.conformer_detail, prefix="/api")

# ---- Serve the website ----
app.mount("/", StaticFiles(directory="website", html=True), name="static")
