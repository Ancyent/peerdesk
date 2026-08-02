import asyncio
import os
from logging.config import fileConfig
from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from database import Base
import models  # noqa: F401 — registers models on Base.metadata

config = context.config
if config.config_file_name is not None:
    # disable_existing_loggers defaults to True, which silences every logger
    # alembic.ini does not name - including all of ours. Alembic only needs to
    # configure its own; it has no business disabling the application's.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://peerdesk:peerdesk@localhost:5432/peerdesk"
)


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(
            lambda sync_conn: context.configure(
                connection=sync_conn,
                target_metadata=target_metadata,
            )
        )
        await conn.run_sync(lambda _: context.run_migrations())
    await engine.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
