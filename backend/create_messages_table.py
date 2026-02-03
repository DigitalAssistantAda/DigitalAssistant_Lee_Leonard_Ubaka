"""
Create messages table in database
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from database import engine, Base
from models.message import Message

print("Creating messages table...")
Base.metadata.tables['messages'].create(engine, checkfirst=True)
print("✓ Messages table created successfully!")
