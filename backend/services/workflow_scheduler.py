"""
Background scheduler loop for automatic workflow generation.
"""
from __future__ import annotations

import asyncio

from database import SessionLocal
from models import Website
from routers.pins import run_generation_job
from services.workflow_service import (
    build_generation_payload,
    create_generation_job,
    get_workflow_status,
    should_auto_generate,
)


CHECK_INTERVAL_SECONDS = 300


async def run_workflow_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        db = SessionLocal()
        try:
            websites = db.query(Website).all()
            for website in websites:
                try:
                    status = get_workflow_status(db, website)
                    if not should_auto_generate(status):
                        continue
                    payload = build_generation_payload(db, website)
                    if payload.get("no_generation_reason"):
                        continue
                    job = create_generation_job(db, website.id, payload, reason="auto_scheduler")
                    asyncio.create_task(asyncio.to_thread(run_generation_job, job.id))
                except Exception:
                    # Keep scheduler loop alive for other websites.
                    continue
        finally:
            db.close()

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=CHECK_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            continue
