# SwapDeck v2 — Practical Execution Plan

## Product Goal

SwapDeck v2 should let a low-technical user go from:

- no local AI tooling
- no understanding of llama.cpp or config files
- no manual terminal setup

to:

- a working local model
- a UI that explains what is happening
- recommendations that fit their hardware
- one obvious path to test and use the model

The product is not "a panel for llama-swap". The product is "local AI that regular people can actually start".

---

## Core Product Principles

1. Reliability over flexibility
   If the stack is fragile, the target user loses immediately.

2. One valid path first
   We should support one clearly working architecture before adding optional backends and advanced modes.

3. UI should remove config burden
   Users should not need to learn llama-swap, GGUF naming, GPU flags, or YAML before they get value.

4. Hardware-aware defaults
   Recommendations and generated config should be based on the user's actual machine.

5. Docker is the delivery method, not the product
   Docker exists to reduce setup pain. It should not force a worse runtime design.

---

## Recommended Architecture

### Chosen Direction

Use **three main runtime pieces**:

- `swapdeck`
  React + FastAPI
  UI, orchestration, downloads, settings, recommendations, logs

- `llama-runtime`
  Single container containing:
  - `llama-swap`
  - `llama-server`
  - supporting scripts

- shared host volumes
  - `./models`
  - `./config`

### Why This Architecture

`llama-swap` normally starts model processes itself from commands in `config.yaml`.

That means splitting `llama-swap` and `llama-server` into separate containers is awkward unless we:

- give Docker socket access
- invent container orchestration logic
- or abandon the normal llama-swap process model

All three add complexity too early.

Putting `llama-swap` and `llama-server` in the same runtime container is the simplest reliable design for v2.

### Not In MVP

These should not be part of the first architecture:

- Docker socket control from SwapDeck
- separate llama-swap and llama-server containers with spawn orchestration
- Ollama as a first-class backend
- multi-backend switching

---

## MVP Definition

SwapDeck v2 MVP is successful if a user can:

1. Run `docker compose up`
2. Open SwapDeck in the browser
3. See detected hardware
4. Get recommended models for that hardware
5. Download one recommended GGUF
6. Auto-generate a working llama-swap config entry
7. Start inference
8. Send a test prompt successfully

That is the MVP.

If a feature does not directly help those 8 steps, it is not MVP-critical.

---

## Phase 0 — Architecture Validation

### Goal

Prove the runtime design before building more UI.

### Deliverable

A minimal Docker Compose setup where:

- `swapdeck` runs as one container
- `llama-runtime` runs as one container
- `llama-swap` inside `llama-runtime` can successfully spawn `llama-server`
- models/config are read from shared mounted volumes
- SwapDeck can talk to llama-swap over Docker networking

### Questions To Answer

1. Can `llama-swap` cleanly spawn `llama-server` inside the same container?
2. How should logs be exposed from the runtime container back to SwapDeck?
3. What is the simplest health model?
   - runtime container healthy
   - llama-swap API healthy
   - selected model ready
4. How should GPU access work on:
   - Linux with NVIDIA
   - Windows via WSL2 + Docker Desktop
   - macOS CPU fallback

### Host Requirement

For NVIDIA Docker validation on Linux, the host must already have:

- working NVIDIA drivers
- Docker installed
- NVIDIA Container Toolkit configured so `docker run --gpus all ...` works

Without that host setup, the runtime container can still start, but `llama-server` will not get GPU access.

### Exit Criteria

Do not move beyond Phase 0 until:

- a model can be loaded through llama-swap inside Docker
- a test request returns successfully
- logs are visible
- mounted models/config work as expected

---

## Phase 1 — Docker-Ready SwapDeck

### Goal

Make SwapDeck production-ready inside Docker, independently of the full runtime stack.

### Scope

1. Build frontend for production
2. Serve the built frontend from FastAPI
3. Remove local desktop/terminal assumptions from service code
4. Make GPU monitoring optional and safe when unavailable
5. Support Docker path defaults through environment-aware settings
6. Produce a working `Dockerfile` for SwapDeck

### Note

Part of this already exists in the current repo and should be reused, not rewritten.

---

## Phase 2 — Local Runtime Stack

### Goal

Deliver the first real "one command to local AI" stack.

### Scope

1. Create `llama-runtime` container
   - includes `llama-swap`
   - includes `llama-server`
   - includes runtime entrypoint scripts

2. Create `docker-compose.yml`
   - `swapdeck`
   - `llama-runtime`
   - mounted `models/`
   - mounted `config/`

3. Rework SwapDeck service control for Docker
   - "Start" means validate runtime and trigger model loading if needed
   - "Stop" should be model/runtime aware, not terminal/process-manager based

4. Verify the test page against the Docker runtime

### Exit Criteria

- user can bring up the stack with Docker Compose
- user can load a configured model
- user can test it from the UI

---

## Phase 3 — Hardware Detection And Recommendations

### Goal

Help users pick models that fit their machine instead of forcing them to guess.

### Recommended Implementation

Use `llmfit` inside the `swapdeck` container, not as a separate service.

Why:

- fewer moving parts
- easier API design
- simpler deployment story
- better fit for "one command" UX

### Scope

1. Add hardware detection endpoints
2. Add recommendation endpoints
3. Build a new `Discover` page
4. Add one-click:
   - Download model
   - Add to config

### Output

Recommendations should generate sensible defaults for:

- context size
- GPU layers
- cache settings
- model naming

---

## Phase 4 — First-Run Wizard

### Goal

Take the user from blank install to first working model.

### Wizard Flow

1. Detect hardware
2. Show top model recommendations
3. Let user choose one
4. Download the model
5. Generate initial config
6. Start the model
7. Open the test page

This is where the product becomes truly useful for low-technical users.

---

## Phase 5 — Optional Backend Expansion

### Goal

Expand audience without destabilizing the core stack.

### Candidate

Ollama support.

### Rule

Ollama should remain optional until the llama-swap path is stable, documented, and easy.

Reasons:

- different storage model
- different operational assumptions
- likely GPU contention
- broader maintenance surface

This is valuable, but not part of first delivery.

---

## Phase 6 — Installer And Update Flow

### Goal

Make onboarding obvious for normal users.

### Scope

1. `install.sh`
2. Windows install script
3. update command
4. optional UI update check later

### User Promise

The user should not need to understand:

- Docker volumes
- GPU flags
- config paths
- model startup commands

---

## Explicit Non-Goals For First Release

These are deliberately not first-release targets:

- advanced multi-backend orchestration
- Docker socket control
- Kubernetes or remote cluster support
- exposing every llama-swap config feature in structured UI
- simultaneous llama-swap and Ollama GPU usage

Raw YAML editing remains the escape hatch for advanced users.

---

## Target Repository Shape

```text
SwapDeck/
├── docker-compose.yml
├── Dockerfile
├── install.sh
├── install.ps1
├── backend/
│   ├── main.py
│   ├── requirements.txt
│   └── routers/
├── frontend/
│   └── src/
├── config/
│   └── config.yaml
└── models/
```

---

## Immediate Next Step

Start with **Phase 0**.

Concretely:

1. Create a minimal Dockerized `swapdeck`
2. Create a minimal `llama-runtime` container with both `llama-swap` and `llama-server`
3. Prove one model can be loaded and queried end-to-end

Only after that should we build recommendation flows and onboarding UX on top.

---

## Build Order

1. Phase 0 — validate runtime architecture
2. Phase 1 — make SwapDeck container-ready
3. Phase 2 — complete compose-based local runtime
4. Phase 3 — hardware detection and recommendations
5. Phase 4 — first-run wizard
6. Phase 5 — optional Ollama support
7. Phase 6 — installers and update flow
