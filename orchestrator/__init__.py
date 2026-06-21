"""Shadow orchestrator agent package."""

# Load .env before any submodule reads env vars (intent.py builds its OpenAI
# client from ASI_ONE_API_KEY at import time).
from dotenv import load_dotenv

load_dotenv()
