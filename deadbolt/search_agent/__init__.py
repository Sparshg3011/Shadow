"""shadow-amazon-search agent package."""

# Load .env before any submodule reads env vars (search.py builds its Anthropic
# client from ANTHROPIC_API_KEY at import time).
from dotenv import load_dotenv

load_dotenv()
