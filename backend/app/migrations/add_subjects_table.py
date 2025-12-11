"""
Migration script to add subjects table and subject_id columns to test_configs and flashcard_decks.
Run this script once to add support for organizing tests and flashcards into subjects.

Note: If you're starting fresh, these changes will be created automatically by SQLAlchemy's create_all().
This script is for adding to an existing database.
"""
import sqlite3
import os

# Determine database path
if os.path.exists("/app/data"):
    DATABASE_PATH = "/app/data/aipt.db"
else:
    DATABASE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "aipt.db")


def migrate(db_path: str = None):
    """Create subjects table and add subject_id columns if they don't exist."""
    db_path = db_path or DATABASE_PATH
    print(f"Using database: {db_path}")
    
    if not os.path.exists(db_path):
        print(f"Database not found at {db_path}")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Check existing tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        existing_tables = {row[0] for row in cursor.fetchall()}
        
        # Create subjects table
        if 'subjects' not in existing_tables:
            cursor.execute("""
                CREATE TABLE subjects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    ai_model_id INTEGER REFERENCES ai_models(id),
                    document_ids JSON,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX ix_subjects_id ON subjects(id)")
            print("Created 'subjects' table")
        else:
            print("'subjects' table already exists")
        
        # Add subject_id column to test_configs if it doesn't exist
        cursor.execute("PRAGMA table_info(test_configs)")
        test_config_columns = {row[1] for row in cursor.fetchall()}
        
        if 'subject_id' not in test_config_columns:
            cursor.execute("""
                ALTER TABLE test_configs
                ADD COLUMN subject_id INTEGER REFERENCES subjects(id)
            """)
            cursor.execute("CREATE INDEX ix_test_configs_subject_id ON test_configs(subject_id)")
            print("Added 'subject_id' column to test_configs")
        else:
            print("'subject_id' column already exists in test_configs")
        
        # Add subject_id column to flashcard_decks if it doesn't exist
        cursor.execute("PRAGMA table_info(flashcard_decks)")
        deck_columns = {row[1] for row in cursor.fetchall()}
        
        if 'subject_id' not in deck_columns:
            cursor.execute("""
                ALTER TABLE flashcard_decks
                ADD COLUMN subject_id INTEGER REFERENCES subjects(id)
            """)
            cursor.execute("CREATE INDEX ix_flashcard_decks_subject_id ON flashcard_decks(subject_id)")
            print("Added 'subject_id' column to flashcard_decks")
        else:
            print("'subject_id' column already exists in flashcard_decks")
        
        conn.commit()
        print("Migration completed successfully!")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()

