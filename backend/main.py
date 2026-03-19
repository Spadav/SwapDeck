#!/usr/bin/env python3
"""
Llama Swap Control Panel - Backend
Manages llama-swap service, models, and configuration
"""
import os
import sys
import re
import json
import glob
import shlex
import shutil
import subprocess
import logging
from pathlib import Path
from typing import Optional, Dict, List, Any
from dataclasses import dataclass, field
from datetime import datetime
from urllib.parse import quote

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/tmp/llama_control_panel.log')
    ]
)
logger = logging.getLogger(__name__)

import yaml
import requests
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl
import uvicorn

# Configuration
LLAMA_SWAP_PROCESS_FILE = "/tmp/llama_swap.pid"
LLAMA_SWAP_LOG_FILE = "/tmp/llama_swap.log"

SETTINGS_FILE = Path(__file__).parent / "settings.json"
FRONTEND_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
CONFIG_EXAMPLE_FILE = Path(__file__).resolve().parent.parent / "config.example.yaml"
NO_CACHE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}

DEFAULT_SETTINGS = {
    "gguf_directory": "~/models",
    "llama_swap_dir": "~/llama-swap",
    "llama_swap_config": "~/llama-swap/config.yaml",
    "llama_swap_port": 8090,
    "backend_port": 8091,
}


def get_llama_swap_executable() -> str:
    """Resolve llama-swap to an executable path that also works from GUI-launched shells."""
    configured = os.environ.get("LLAMA_SWAP_BIN")
    candidates = [
        configured,
        shutil.which("llama-swap"),
        os.path.expanduser("~/.local/bin/llama-swap"),
        "/home/linuxbrew/.linuxbrew/bin/llama-swap",
        "/usr/local/bin/llama-swap",
        "/usr/bin/llama-swap",
    ]

    for candidate in candidates:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate

    raise HTTPException(
        status_code=500,
        detail=(
            "Failed to find llama-swap executable. Set LLAMA_SWAP_BIN or install "
            "llama-swap somewhere in PATH."
        ),
    )


def load_settings() -> Dict[str, Any]:
    """Load settings from settings.json, falling back to defaults if missing."""
    settings = dict(DEFAULT_SETTINGS)
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r") as f:
                saved = json.load(f)
            settings.update(saved)
        except Exception as e:
            logger.warning(f"Failed to load settings.json, using defaults: {e}")
    return settings


def save_settings(new_settings: Dict[str, Any]) -> None:
    """Save settings to settings.json."""
    with open(SETTINGS_FILE, "w") as f:
        json.dump(new_settings, f, indent=2)
        f.write("\n")


settings = load_settings()

logger.info(f"LLAMA_SWAP_CONFIG: {settings['llama_swap_config']}")
logger.info(f"GGUF_DIRECTORY: {settings['gguf_directory']}")

app = FastAPI(title="LLM Control Panel", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve built frontend files when available (single-process runtime mode).
if (FRONTEND_DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST_DIR / "assets"), name="assets")


@dataclass
class DownloadTask:
    url: str
    filename: str
    progress: float = 0.0
    status: str = "pending"
    error: Optional[str] = None

active_downloads: Dict[str, DownloadTask] = {}


def run_command(cmd: List[str], timeout: float = 30.0) -> subprocess.CompletedProcess:
    """Run a shell command and return the result"""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        return result
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail=f"Command timed out: {' '.join(cmd)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Command failed: {str(e)}")


def get_gpu_stats() -> Dict[str, Any]:
    """Get NVIDIA GPU statistics using nvidia-smi"""
    try:
        result = run_command(["nvidia-smi", "--query-gpu=memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"])
        if result.returncode == 0:
            parts = result.stdout.strip().split(",")
            if len(parts) >= 2:
                return {
                    "memory_used_gb": round(int(parts[0].strip()) / 1024, 1),
                    "memory_total_gb": round(int(parts[1].strip()) / 1024, 1),
                    "temperature_c": int(parts[2].strip()) if len(parts) > 2 else 0
                }
        return {"memory_used_gb": 0, "memory_total_gb": 0, "temperature_c": 0}
    except Exception:
        return {"memory_used_gb": 0, "memory_total_gb": 0, "temperature_c": 0}


def is_llama_swap_running() -> bool:
    """Check if llama-swap is running via a lightweight endpoint."""
    port = settings["llama_swap_port"]
    try:
        logger.info("Checking if llama-swap is running...")
        # /v1/models avoids triggering expensive model health workflows that / may invoke.
        response = requests.get(f"http://127.0.0.1:{port}/v1/models", timeout=2)
        logger.info(f"llama-swap responded with status {response.status_code}")
        return response.status_code == 200
    except requests.ConnectionError:
        logger.info(f"llama-swap not responding on port {port}")
        return False
    except Exception as e:
        logger.error(f"Error checking llama-swap status: {e}")
        return False


def get_llama_swap_pid() -> Optional[int]:
    """Get the PID of the running llama-swap process"""
    try:
        llama_swap_bin = get_llama_swap_executable()
        result = run_command(["pgrep", "-f", llama_swap_bin])
        if result.returncode == 0:
            pid = int(result.stdout.strip().split()[0])
            logger.info(f"Found llama-swap PID: {pid}")
            return pid
        return None
    except Exception:
        return None


def start_llama_swap() -> Dict[str, Any]:
    """Start llama-swap service in a visible terminal window"""
    try:
        if is_llama_swap_running():
            return {"running": True, "pid": get_llama_swap_pid()}

        # Launch llama-swap in a new visible terminal window
        swap_dir = os.path.expanduser(settings["llama_swap_dir"])
        swap_config = os.path.expanduser(settings["llama_swap_config"])
        swap_port = settings["llama_swap_port"]
        llama_swap_bin = get_llama_swap_executable()
        # Mirror llama-swap output to a log file so the Status page can show it.
        cmd = (
            f"cd {swap_dir} && "
            f"{shlex.quote(llama_swap_bin)} --config {shlex.quote(swap_config)} "
            f"--listen 0.0.0.0:{swap_port} 2>&1 | tee -a {shlex.quote(LLAMA_SWAP_LOG_FILE)}; "
            "exec bash"
        )
        env = os.environ.copy()
        env.setdefault("DISPLAY", ":0")
        process = subprocess.Popen(
            ["gnome-terminal", "--title=llama-swap", "--", "bash", "-c", cmd],
            start_new_session=True,
            env=env
        )

        return {"running": True, "message": "llama-swap launched in new terminal"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start llama-swap: {str(e)}")


def stop_llama_swap() -> Dict[str, Any]:
    """Stop llama-swap and all child processes (including llama-server) and close terminal"""
    try:
        llama_swap_bin = get_llama_swap_executable()
        # Kill llama-server first, then llama-swap
        for pattern in ["llama-server", llama_swap_bin]:
            subprocess.run(["pkill", "-f", pattern], capture_output=True)

        import time
        time.sleep(1)

        # Force kill any survivors
        for pattern in ["llama-server", llama_swap_bin]:
            subprocess.run(["pkill", "-9", "-f", pattern], capture_output=True)

        # Close the terminal window by killing the bash shell that has our command
        swap_dir = os.path.expanduser(settings["llama_swap_dir"])
        subprocess.run(
            ["pkill", "-f", f"cd {swap_dir} && {llama_swap_bin}"],
            capture_output=True
        )

        if os.path.exists(LLAMA_SWAP_PROCESS_FILE):
            os.remove(LLAMA_SWAP_PROCESS_FILE)
        return {"stopped": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop llama-swap: {str(e)}")


def get_recent_logs(lines: int = 100) -> List[str]:
    """Get recent llama-swap logs"""
    try:
        if os.path.exists(LLAMA_SWAP_LOG_FILE):
            with open(LLAMA_SWAP_LOG_FILE, "r") as f:
                all_lines = f.readlines()
                return [line.rstrip() for line in all_lines[-lines:]]
        return []
    except Exception:
        return []


def get_upstream_logs(lines: int = 100) -> List[str]:
    """Get model/upstream-related logs by filtering out noisy proxy request lines."""
    all_logs = get_recent_logs(lines=lines * 6)
    if not all_logs:
        return []

    filtered = []
    for line in all_logs:
        # Hide routine access logs to keep model process output visible.
        if "Request " in line and "HTTP/1.1" in line:
            continue
        if "GET /v1/models" in line:
            continue
        filtered.append(line)

    return filtered[-lines:]


def get_llama_swap_events(lines: int = 100) -> List[str]:
    """Fetch recent llama-swap events from its API, if available."""
    port = settings["llama_swap_port"]
    try:
        response = requests.get(f"http://127.0.0.1:{port}/api/events", timeout=3)
        if response.status_code != 200:
            return []

        content_type = response.headers.get("content-type", "").lower()
        if "application/json" in content_type:
            payload = response.json()
            if isinstance(payload, list):
                return [str(item) for item in payload[-lines:]]
            return [json.dumps(payload)]

        raw_lines = [line for line in response.text.splitlines() if line.strip()]
        return raw_lines[-lines:]
    except Exception:
        return []


def list_gguf_files() -> List[Dict[str, Any]]:
    """List all GGUF model files in the directory"""
    models = []
    gguf_path = Path(os.path.expanduser(settings["gguf_directory"]))
    
    if not gguf_path.exists():
        return models
    
    for file_path in gguf_path.glob("*.gguf"):
        try:
            stat = file_path.stat()
            models.append({
                "filename": file_path.name,
                "size_bytes": stat.st_size,
                "size_gb": round(stat.st_size / (1024**3), 2),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
        except Exception:
            continue
    
    return models


def delete_model(filename: str) -> Dict[str, Any]:
    """Delete a model file"""
    file_path = Path(os.path.expanduser(settings["gguf_directory"])) / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found")
    
    file_path.unlink()
    return {"deleted": filename}


def download_model(url: str, filename: str) -> str:
    """Start downloading a model from HuggingFace"""
    task_id = filename
    active_downloads[task_id] = DownloadTask(url=str(url), filename=filename, status="downloading")
    return task_id


def list_hf_gguf_files(repo_id: str) -> List[Dict[str, Any]]:
    """List GGUF files in a Hugging Face repository."""
    headers = {}
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        headers["Authorization"] = f"Bearer {hf_token}"

    response = requests.get(
        f"https://huggingface.co/api/models/{repo_id}",
        params=[("expand[]", "siblings")],
        headers=headers,
        timeout=20,
    )

    if response.status_code == 404:
        raise HTTPException(status_code=404, detail=f"Repo not found: {repo_id}")
    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail=f"Hugging Face API error: {response.text}",
        )

    data = response.json()
    siblings = data.get("siblings") or []
    files = []

    for item in siblings:
        rfilename = item.get("rfilename") or ""
        if not rfilename.lower().endswith(".gguf"):
            continue

        files.append({
            "path": rfilename,
            "filename": Path(rfilename).name,
            "size_bytes": item.get("size"),
            "download_url": f"https://huggingface.co/{repo_id}/resolve/main/{quote(rfilename, safe='/')}?download=true",
        })

    files.sort(key=lambda x: x["path"].lower())
    return files


def get_config() -> Dict[str, Any]:
    """Get llama-swap configuration"""
    config_path = os.path.expanduser(settings["llama_swap_config"])
    logger.info(f"Loading config from: {config_path}")
    config_file = Path(config_path)
    
    if not config_file.exists():
        logger.warning(f"Config file not found: {config_file}")
        raise HTTPException(status_code=404, detail=f"Config file not found: {config_file}")
    
    try:
        with open(config_file, "r") as f:
            config = yaml.safe_load(f) or {}
        logger.info(f"Config loaded successfully: {list(config.keys())}")
        return config
    except Exception as e:
        logger.error(f"Error loading config: {e}")
        raise HTTPException(status_code=500, detail=f"Error loading config: {str(e)}")


def save_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Save llama-swap configuration"""
    config_file = Path(os.path.expanduser(settings["llama_swap_config"]))
    
    with open(config_file, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)
    
    return {"saved": True}


def get_config_raw() -> str:
    """Get raw llama-swap configuration text."""
    config_file = Path(os.path.expanduser(settings["llama_swap_config"]))

    if not config_file.exists():
        raise HTTPException(status_code=404, detail=f"Config file not found: {config_file}")

    try:
        return config_file.read_text()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading raw config: {str(e)}")


def save_config_raw(content: str) -> Dict[str, Any]:
    """Validate and save raw llama-swap configuration text."""
    config_file = Path(os.path.expanduser(settings["llama_swap_config"]))

    try:
        parsed = yaml.safe_load(content) if content.strip() else {}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {str(e)}")

    if parsed is None:
        parsed = {}

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Config root must be a YAML mapping/object")

    try:
        config_file.write_text(content if content.endswith("\n") else f"{content}\n")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error saving raw config: {str(e)}")

    return {"saved": True}


def get_config_guide() -> str:
    """Get the bundled llama-swap config example used as a guide."""
    if not CONFIG_EXAMPLE_FILE.exists():
        raise HTTPException(status_code=404, detail="Config guide file not found")

    try:
        return CONFIG_EXAMPLE_FILE.read_text()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading config guide: {str(e)}")


def rename_model(old_name: str, new_name: str) -> Dict[str, Any]:
    """Rename a model file"""
    old_path = Path(os.path.expanduser(settings["gguf_directory"])) / old_name
    new_path = Path(os.path.expanduser(settings["gguf_directory"])) / new_name
    
    if not old_path.exists():
        raise HTTPException(status_code=404, detail="Model file not found")
    
    if new_path.exists():
        raise HTTPException(status_code=409, detail="Target filename already exists")
    
    old_path.rename(new_path)
    return {"renamed": {"from": old_name, "to": new_name}}


class DownloadRequest(BaseModel):
    url: str
    filename: str


class TestPrompt(BaseModel):
    prompt: str
    model: str = ""


class RawConfigRequest(BaseModel):
    content: str


@app.get("/api/models")
def api_list_models():
    """List all GGUF model files with metadata"""
    return list_gguf_files()


@app.delete("/api/models/{filename}")
def api_delete_model(filename: str):
    """Delete a model file"""
    return delete_model(filename)


@app.post("/api/models/download")
def api_download_model(req: DownloadRequest):
    """Start downloading a model from HuggingFace"""
    task_id = download_model(req.url, req.filename)
    return {"task_id": task_id, "status": "started"}


@app.get("/api/hf/repo-files")
def api_hf_repo_files(repo_id: str = Query(..., description="owner/repo")):
    """List GGUF files for a Hugging Face repository."""
    repo_id = repo_id.strip()
    if not repo_id or "/" not in repo_id:
        raise HTTPException(status_code=400, detail="repo_id must be in format owner/repo")
    return {"repo_id": repo_id, "files": list_hf_gguf_files(repo_id)}


@app.put("/api/models/{old_name}")
def api_rename_model(old_name: str, new_name: str):
    """Rename a model file"""
    return rename_model(old_name, new_name)


@app.get("/api/config")
def api_get_config():
    """Get llama-swap configuration"""
    logger.info("API: /api/config called")
    return get_config()


@app.put("/api/config")
def api_save_config(config: Dict[str, Any]):
    """Save llama-swap configuration"""
    return save_config(config)


@app.get("/api/config/raw")
def api_get_config_raw():
    """Get raw llama-swap configuration text."""
    return {"content": get_config_raw()}


@app.put("/api/config/raw")
def api_save_config_raw(payload: RawConfigRequest):
    """Save raw llama-swap configuration text."""
    return save_config_raw(payload.content)


@app.get("/api/config/guide")
def api_get_config_guide():
    """Get the bundled llama-swap config example as a guide."""
    return {"content": get_config_guide()}


@app.get("/api/status")
def api_status():
    """Get llama-swap status and GPU stats"""
    logger.info("API: /api/status called")
    running = is_llama_swap_running()
    pid = get_llama_swap_pid() if running else None
    gpu_stats = get_gpu_stats()
    
    logger.info(f"Status: running={running}, pid={pid}, gpu={gpu_stats}")
    
    return {
        "running": running,
        "pid": pid,
        "gpu": gpu_stats
    }


@app.post("/api/service/start")
def api_start_service():
    """Start llama-swap service"""
    return start_llama_swap()


@app.post("/api/service/stop")
def api_stop_service():
    """Stop llama-swap service"""
    return stop_llama_swap()


@app.get("/api/logs")
def api_logs(lines: int = 100):
    """Get recent llama-swap logs"""
    return get_recent_logs(lines)


@app.get("/api/logs/upstream")
def api_upstream_logs(lines: int = 100):
    """Get recent upstream/model logs (filtered)."""
    return get_upstream_logs(lines)


@app.get("/api/logs/events")
def api_log_events(lines: int = 100):
    """Get recent llama-swap event logs from its own API."""
    events = get_llama_swap_events(lines)
    if events:
        return events
    # Fallback to captured upstream/model logs when events API is empty/unavailable.
    return get_upstream_logs(lines)


@app.get("/api/logs/stream/{stream_type}")
def api_stream_logs(stream_type: str):
    """Proxy llama-swap SSE log streams to the frontend."""
    if stream_type not in {"proxy", "upstream"}:
        raise HTTPException(status_code=404, detail="Unknown stream type")

    port = settings["llama_swap_port"]
    target_url = f"http://127.0.0.1:{port}/logs/stream/{stream_type}"

    def event_generator():
        try:
            with requests.get(target_url, stream=True, timeout=(3, None)) as response:
                if response.status_code != 200:
                    yield f"data: [error] Upstream returned HTTP {response.status_code}\n\n"
                    return

                for raw_line in response.iter_lines(decode_unicode=True):
                    if raw_line is None:
                        continue
                    line = raw_line.strip()
                    if not line:
                        continue
                    # Forward every line as a simple SSE data message.
                    yield f"data: {line}\n\n"
        except Exception as e:
            yield f"data: [error] Failed to read {stream_type} stream: {e}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/test")
def api_test_prompt(prompt: TestPrompt):
    """Send a test prompt to the selected model via llama-swap OpenAI-compatible API"""
    import time
    try:
        payload = {
            "messages": [{"role": "user", "content": prompt.prompt}],
            "max_tokens": 512,
        }
        if prompt.model:
            payload["model"] = prompt.model

        start = time.time()
        response = requests.post(
            f"http://127.0.0.1:{settings['llama_swap_port']}/v1/chat/completions",
            json=payload,
            timeout=120
        )
        duration_ms = int((time.time() - start) * 1000)

        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)

        result = response.json()
        choice = result.get("choices", [{}])[0]
        message = choice.get("message", {})
        content = message.get("content", "")
        reasoning = message.get("reasoning_content", "")
        usage = result.get("usage", {})
        timings = result.get("timings", {})
        tokens = usage.get("completion_tokens", 0)

        return {
            "response": content,
            "reasoning": reasoning,
            "tokens": tokens,
            "duration_ms": duration_ms,
            "model": result.get("model", prompt.model),
            "usage": usage,
            "timings": timings,
            "id": result.get("id"),
            "object": result.get("object"),
            "created": result.get("created"),
            "system_fingerprint": result.get("system_fingerprint"),
            "finish_reason": choice.get("finish_reason"),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Request failed: {str(e)}")


@app.websocket("/ws/download/{task_id}")
async def websocket_download(websocket: WebSocket, task_id: str):
    """WebSocket for download progress updates"""
    await websocket.accept()
    
    if task_id not in active_downloads:
        await websocket.close()
        return
    
    task = active_downloads[task_id]
    dest_path = Path(os.path.expanduser(settings["gguf_directory"])) / task.filename
    
    try:
        response = requests.get(task.url, stream=True)
        response.raise_for_status()
        
        total_size = int(response.headers.get("content-length", 0))
        downloaded = 0
        
        with open(dest_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_size:
                        task.progress = (downloaded / total_size) * 100
                    await websocket.send_json({"progress": task.progress, "status": "downloading"})
        
        task.progress = 100
        task.status = "completed"
        await websocket.send_json({"progress": 100, "status": "completed"})
        
    except Exception as e:
        task.status = "error"
        task.error = str(e)
        await websocket.send_json({"status": "error", "error": str(e)})
    
    del active_downloads[task_id]
    await websocket.close()


@app.get("/api/settings")
def api_get_settings():
    """Get current settings"""
    return settings


@app.put("/api/settings")
def api_save_settings(new_settings: Dict[str, Any]):
    """Save settings to settings.json and update in-memory values"""
    global settings
    # Only allow known keys
    for key in DEFAULT_SETTINGS:
        if key in new_settings:
            settings[key] = new_settings[key]
    save_settings(settings)
    return settings


@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/", include_in_schema=False)
def serve_frontend_index():
    """Serve the built frontend index if present."""
    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file, headers=NO_CACHE_HEADERS)
    raise HTTPException(
        status_code=404,
        detail="Frontend build not found. Run `cd frontend && npm run build`."
    )


@app.get("/{full_path:path}", include_in_schema=False)
def serve_frontend_spa(full_path: str):
    """SPA fallback for client-side routes when serving built frontend."""
    if full_path.startswith(("api/", "ws/", "health")):
        raise HTTPException(status_code=404, detail="Not Found")

    candidate = FRONTEND_DIST_DIR / full_path
    if candidate.exists() and candidate.is_file():
        return FileResponse(candidate)

    index_file = FRONTEND_DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file, headers=NO_CACHE_HEADERS)
    raise HTTPException(
        status_code=404,
        detail="Frontend build not found. Run `cd frontend && npm run build`."
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings["backend_port"])
