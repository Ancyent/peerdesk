from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, machines, users, turn, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


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


@app.get("/health")
async def health():
    return {"status": "ok"}
