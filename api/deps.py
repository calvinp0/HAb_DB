from typing import Generator
from sqlalchemy.orm import Session
from db.engine import get_session_factory

SessionLocal = get_session_factory()  # Gets the session maker


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()  # Create a new database session
    try:
        yield db  # Yield the session to be used in the request
    finally:
        db.close()  # Ensure the session is closed after the request is done
