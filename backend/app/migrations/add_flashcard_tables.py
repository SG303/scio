"""
Migration script to add flashcard tables.
Run this script once to add the flashcard_decks, flashcards, flashcard_reviews, and study_sessions tables.

Note: If you're starting fresh, these tables will be created automatically by SQLAlchemy's create_all().
This script is for adding tables to an existing database.
"""
import sqlite3
import os

# Determine database path
if os.path.exists("/app/data"):
    DATABASE_PATH = "/app/data/aipt.db"
else:
    DATABASE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "aipt.db")


def migrate(db_path: str = None):
    """Create flashcard tables if they don't exist."""
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
        
        # Create flashcard_decks table
        if 'flashcard_decks' not in existing_tables:
            cursor.execute("""
                CREATE TABLE flashcard_decks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    ai_model_id INTEGER REFERENCES ai_models(id),
                    document_ids JSON,
                    custom_prompt TEXT,
                    new_cards_per_day INTEGER DEFAULT 20,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX ix_flashcard_decks_id ON flashcard_decks(id)")
            print("Created 'flashcard_decks' table")
        else:
            print("'flashcard_decks' table already exists")
        
        # Create flashcards table
        if 'flashcards' not in existing_tables:
            cursor.execute("""
                CREATE TABLE flashcards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    deck_id INTEGER NOT NULL REFERENCES flashcard_decks(id),
                    front TEXT NOT NULL,
                    back TEXT NOT NULL,
                    state VARCHAR(20) DEFAULT 'new',
                    easiness_factor REAL DEFAULT 2.5,
                    interval_days INTEGER DEFAULT 0,
                    repetitions INTEGER DEFAULT 0,
                    next_review_at DATETIME,
                    learning_step INTEGER DEFAULT 0,
                    source_type VARCHAR(50),
                    source_question_id INTEGER REFERENCES questions(id),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_reviewed_at DATETIME
                )
            """)
            cursor.execute("CREATE INDEX ix_flashcards_id ON flashcards(id)")
            cursor.execute("CREATE INDEX ix_flashcards_deck_id ON flashcards(deck_id)")
            cursor.execute("CREATE INDEX ix_flashcards_next_review_at ON flashcards(next_review_at)")
            print("Created 'flashcards' table")
        else:
            print("'flashcards' table already exists")
        
        # Create flashcard_reviews table
        if 'flashcard_reviews' not in existing_tables:
            cursor.execute("""
                CREATE TABLE flashcard_reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    card_id INTEGER NOT NULL REFERENCES flashcards(id),
                    rating INTEGER NOT NULL,
                    time_taken_ms INTEGER,
                    state_before VARCHAR(20),
                    interval_before INTEGER,
                    reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cursor.execute("CREATE INDEX ix_flashcard_reviews_id ON flashcard_reviews(id)")
            cursor.execute("CREATE INDEX ix_flashcard_reviews_card_id ON flashcard_reviews(card_id)")
            cursor.execute("CREATE INDEX ix_flashcard_reviews_reviewed_at ON flashcard_reviews(reviewed_at)")
            print("Created 'flashcard_reviews' table")
        else:
            print("'flashcard_reviews' table already exists")
        
        # Create study_sessions table
        if 'study_sessions' not in existing_tables:
            cursor.execute("""
                CREATE TABLE study_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    deck_id INTEGER REFERENCES flashcard_decks(id),
                    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    completed_at DATETIME,
                    cards_reviewed INTEGER DEFAULT 0,
                    cards_again INTEGER DEFAULT 0,
                    cards_hard INTEGER DEFAULT 0,
                    cards_good INTEGER DEFAULT 0,
                    cards_easy INTEGER DEFAULT 0,
                    total_time_ms INTEGER DEFAULT 0
                )
            """)
            cursor.execute("CREATE INDEX ix_study_sessions_id ON study_sessions(id)")
            print("Created 'study_sessions' table")
        else:
            print("'study_sessions' table already exists")
        
        conn.commit()
        print("Migration completed successfully!")
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()

