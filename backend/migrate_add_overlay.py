#!/usr/bin/env python3
"""
Database migration script to add overlay_svg column to templates table.

Run this script to update existing databases:
  python migrate_add_overlay.py
"""
import sys
from pathlib import Path

# Add parent directory to path to import database module
sys.path.insert(0, str(Path(__file__).parent))

from database import engine, SessionLocal
from models import Base


def migrate():
    """Add overlay_svg column to templates table if it doesn't exist."""
    print("Starting migration: Add overlay_svg column to templates...")

    # Get database connection
    from sqlalchemy import text
    conn = engine.connect()

    try:
        # Check if column already exists
        result = conn.execute(text("PRAGMA table_info(templates)"))
        columns = [row[1] for row in result]

        if 'overlay_svg' in columns:
            print("Column 'overlay_svg' already exists. Skipping migration.")
            return

        # Add the column
        print("Adding 'overlay_svg' column to templates table...")
        conn.execute(text("ALTER TABLE templates ADD COLUMN overlay_svg VARCHAR(512)"))
        conn.commit()

        print("Migration completed successfully!")

    except Exception as e:
        print(f"Migration failed: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
