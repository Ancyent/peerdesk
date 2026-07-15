import asyncio
import contextlib
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import release_cache
from routers import auth, machines, users, turn, sessions, totp, branding, companies, locations, groups, tokens, api_keys, releases


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Mirror GitHub releases locally so no client ever has to call the GitHub
    # API (60 req/hour per source IP — shared by every client behind one NAT).
    task = asyncio.create_task(release_cache.refresh_loop(), name="release-refresh")
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(title="PeerDesk API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(machines.router)
app.include_router(users.router)
app.include_router(turn.router)
app.include_router(sessions.router)
app.include_router(totp.router)
app.include_router(branding.router)
app.include_router(companies.router)
app.include_router(locations.router)
app.include_router(groups.router)
app.include_router(tokens.router)
app.include_router(api_keys.router)
app.include_router(releases.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
