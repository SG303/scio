"""
Migration script to add template fields to test_configs table.
Run this script once to add the is_template and custom_prompt columns.
"""
import sqlite3
import os

# Determine database path
if os.path.exists("/app/data"):
    DATABASE_PATH = "/app/data/aipt.db"
else:
    DATABASE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "aipt.db")


def migrate(db_path: str = None):
    """Add is_template and custom_prompt columns to test_configs table if they don't exist."""
    db_path = db_path or DATABASE_PATH
    print(f"Using database: {db_path}")
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Check if columns exist
        cursor.execute("PRAGMA table_info(test_configs)")
        columns = cursor.fetchall()
        column_names = [col[1] for col in columns]
        
        # Add is_template column if it doesn't exist
        if 'is_template' not in column_names:
            cursor.execute(
                "ALTER TABLE test_configs ADD COLUMN is_template BOOLEAN DEFAULT 0"
            )
            print("Added 'is_template' column to test_configs table")
        else:
            print("'is_template' column already exists")
        
        # Add custom_prompt column if it doesn't exist
        if 'custom_prompt' not in column_names:
            cursor.execute(
                "ALTER TABLE test_configs ADD COLUMN custom_prompt TEXT"
            )
            print("Added 'custom_prompt' column to test_configs table")
        else:
            print("'custom_prompt' column already exists")
        
        conn.commit()
        print("Migration completed successfully!")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
