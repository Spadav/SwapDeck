# SwapDeck

SwapDeck is a web-based control panel for managing local LLMs through [llama-swap](https://github.com/mostlygeek/llama-swap). Download GGUF models, edit llama-swap configuration, start/stop the service, monitor your GPU, and test models from a single dashboard.

## Features

- **Service Control** — Start/stop llama-swap from the UI; live status indicator in the sidebar
- **Configuration Editor** — Edit llama-swap's `config.yaml` (models, commands, proxies, aliases, filters) with a structured form
- **Model Management** — Browse installed `.gguf` files, download new ones from HuggingFace with a real-time progress bar, rename or delete models
- **Quick Test** — Pick a model from the config, type a prompt, and see the response with token count and latency
- **GPU Monitoring** — Real-time NVIDIA GPU memory and temperature in the header bar
- **Settings** — Configure all paths and ports (GGUF directory, llama-swap location, ports) so nothing is hardcoded to one machine
- **Dark Mode** — Toggle between light and dark themes

## Prerequisites

- Python 3.9+
- Node.js 18+
- [llama-swap](https://github.com/mostlygeek/llama-swap) installed somewhere on your system
- NVIDIA GPU with `nvidia-smi` available (GPU stats degrade gracefully if missing)
- Linux with GNOME Terminal (used to launch llama-swap in a visible window)

## Quick Start

### 1. Clone and install

```bash
# Backend
cd backend
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

### 2. Configure paths

Create `backend/settings.json` from the example file:

```bash
cp backend/settings.example.json backend/settings.json
```

Default contents:

```json
{
  "gguf_directory": "~/models",
  "llama_swap_dir": "~/llama-swap",
  "llama_swap_config": "~/llama-swap/config.yaml",
  "llama_swap_port": 8090,
  "backend_port": 8091
}
```

Edit this file directly, or use the **Settings** page in the UI after starting the app. All paths support `~` expansion.

### 3. Run

```bash
# Terminal 1 — backend
cd backend
python main.py
# Starts on http://localhost:8091

# Terminal 2 — frontend dev server
cd frontend
npm run dev
# Opens at http://localhost:3000
```

The frontend dev server proxies `/api` requests to the backend automatically.

## Architecture

```
frontend (React + Vite)        backend (FastAPI + Uvicorn)        llama-swap
  :3000  ──── /api proxy ────>   :8091  ──── HTTP/process ────>    :8090
                                   │
                                   ├── settings.json  (user config)
                                   └── ~/llama-swap/config.yaml  (llama-swap config)
```

### Pages

| Page | Path | Purpose |
|------|------|---------|
| Status | `/status` | Start/stop llama-swap, view GPU stats and logs |
| Config | `/config` | Edit llama-swap `config.yaml` — models, TTL, health checks |
| Models | `/models` | List/download/rename/delete `.gguf` model files |
| Test | `/test` | Send prompts to a running model via llama-swap's OpenAI-compatible API |
| Settings | `/settings` | Configure paths and ports for this control panel |

### How Model Download Works

Downloading a model is a two-phase REST + WebSocket flow:

1. **Initiate** — Frontend POSTs to `/api/models/download` with a URL and filename. Backend registers a download task and returns a `task_id`.
2. **Stream** — Frontend opens a WebSocket at `/ws/download/{task_id}`. Backend streams the file from the URL in 8KB chunks, saving it to the GGUF directory, and pushes `{progress, status}` messages over the WebSocket. The frontend renders a live progress bar. On completion, the model list refreshes automatically.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Service running state + GPU stats |
| POST | `/api/service/start` | Start llama-swap in a terminal window |
| POST | `/api/service/stop` | Stop llama-swap and all child processes |
| GET | `/api/logs?lines=N` | Recent llama-swap log lines |
| GET | `/api/config` | Read llama-swap config.yaml |
| PUT | `/api/config` | Write llama-swap config.yaml |
| GET | `/api/models` | List `.gguf` files with size and date |
| DELETE | `/api/models/{filename}` | Delete a model file |
| PUT | `/api/models/{old_name}?new_name=X` | Rename a model file |
| POST | `/api/models/download` | Start downloading a model (returns task_id) |
| POST | `/api/test` | Send a chat prompt to llama-swap |
| GET | `/api/settings` | Get current settings |
| PUT | `/api/settings` | Update and persist settings |
| GET | `/health` | Health check |

### WebSocket

| Endpoint | Description |
|----------|-------------|
| `ws://HOST:8091/ws/download/{task_id}` | Real-time download progress updates |

## Settings Reference

| Key | Default | Description |
|-----|---------|-------------|
| `gguf_directory` | `~/models` | Directory where `.gguf` model files are stored |
| `llama_swap_dir` | `~/llama-swap` | llama-swap installation directory |
| `llama_swap_config` | `~/llama-swap/config.yaml` | Path to llama-swap's config file |
| `llama_swap_port` | `8090` | Port llama-swap listens on |
| `backend_port` | `8091` | Port this control panel backend runs on (requires restart) |

## Tech Stack

- **Frontend**: React 18, React Router, Tailwind CSS, Vite
- **Backend**: Python, FastAPI, Uvicorn, WebSockets
- **Model server**: llama-swap (wraps llama.cpp's `llama-server`)

## Security Notes

- This project is designed for **local/trusted network use** and does **not** include authentication/authorization by default.
- Do not expose backend (`8091`) or llama-swap (`8090`) directly to the public internet.
- For remote access, prefer a private overlay network such as **Tailscale** instead of opening router/firewall ports.
