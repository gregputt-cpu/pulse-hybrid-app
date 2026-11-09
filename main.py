import os
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, FileResponse

app = FastAPI(title="PULSE Hybrid Athlete OS")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/", response_class=HTMLResponse)
async def get_index():
    index_file = os.path.join(BASE_DIR, "index.html")
    with open(index_file, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())

@app.get("/manifest.json")
async def get_manifest():
    return FileResponse(os.path.join(BASE_DIR, "manifest.json"), media_type="application/manifest+json")

@app.get("/sw.js")
async def get_sw():
    return FileResponse(os.path.join(BASE_DIR, "sw.js"), media_type="application/javascript")

@app.get("/icon.svg")
async def get_icon_svg():
    return FileResponse(os.path.join(BASE_DIR, "icon.svg"), media_type="image/svg+xml")

@app.get("/icon-192.png")
async def get_icon_192():
    return FileResponse(os.path.join(BASE_DIR, "icon-192.png"), media_type="image/png")

@app.get("/icon-512.png")
async def get_icon_512():
    return FileResponse(os.path.join(BASE_DIR, "icon-512.png"), media_type="image/png")

@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "pulse-pwa"}

@app.get("/{file_name}")
async def get_static_file(file_name: str):
    target = os.path.join(BASE_DIR, file_name)
    if os.path.isfile(target):
        if file_name.endswith(".json"):
            return FileResponse(target, media_type="application/json")
        if file_name.endswith(".js"):
            return FileResponse(target, media_type="application/javascript")
        if file_name.endswith(".png"):
            return FileResponse(target, media_type="image/png")
        if file_name.endswith(".svg"):
            return FileResponse(target, media_type="image/svg+xml")
        return FileResponse(target)
    # Default fallback for SPA navigation
    index_file = os.path.join(BASE_DIR, "index.html")
    with open(index_file, "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())
