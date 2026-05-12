from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db
from models import Session
from schemas import SessionStart, SessionOut

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionOut, status_code=201)
async def start_session(body: SessionStart, db: AsyncSession = Depends(get_db)):
    """Called when a remote session starts. No user auth — called by signaling server."""
    session = Session(
        host_peer_id=body.host_peer_id,
        viewer_user_id=body.viewer_user_id,
        connection_type=body.connection_type,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.patch("/{session_id}/end", status_code=204)
async def end_session(session_id: str, db: AsyncSession = Depends(get_db)):
    """Called when a session ends. No user auth — called by signaling server."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.ended_at = datetime.now(timezone.utc)
    await db.commit()
