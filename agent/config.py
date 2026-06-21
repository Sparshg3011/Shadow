"""Environment-driven configuration for the Shadow agent sidecar.

Nothing is hardcoded: models, keys, and loop tuning all come from .env.
"""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the repo root (one level above agent/).
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


@dataclass
class Config:
    anthropic_api_key: str
    openrouter_api_key: str
    engine: str
    effort: str
    reflection: bool
    verify: bool
    display_max: int
    keep_images: int
    gen_model: str
    ground_model: str
    max_steps: int
    traj_window: int
    action_delay: float
    grounding_width: int
    grounding_height: int
    http_host: str
    http_port: int
    http_token: str

    @classmethod
    def load(cls) -> "Config":
        return cls(
            anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip(),
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY", "").strip(),
            # "native" = Anthropic computer-use (one call/step, fast); "agent-s" = Simular Agent-S.
            engine=os.getenv("SHADOW_ENGINE", "native").strip().lower(),
            # Thinking/spend dial for the native engine: low | medium | high | max.
            effort=os.getenv("SHADOW_EFFORT", "medium").strip(),
            # Agent-S reflection adds an LLM call per step; off by default for speed.
            reflection=os.getenv("SHADOW_REFLECTION", "0").strip() not in ("", "0", "false", "False"),
            # Final verification: judge approved/rejected from the end screen. On by default.
            verify=os.getenv("SHADOW_VERIFY", "1").strip() not in ("", "0", "false", "False"),
            # Native engine: cap the screenshot long edge. Big enough to read URLs/text
            # (a 1440-wide screen stays native); lower it only if you want raw speed.
            display_max=int(os.getenv("SHADOW_DISPLAY_MAX", "1568")),
            # Native engine: keep only the most recent N screenshots in context.
            keep_images=int(os.getenv("SHADOW_KEEP_IMAGES", "4")),
            gen_model=os.getenv("SHADOW_GEN_MODEL", "claude-opus-4-8").strip(),
            ground_model=os.getenv("SHADOW_GROUND_MODEL", "bytedance/ui-tars-1.5-7b").strip(),
            # Hard cap on agent loop iterations (runaway/cost guard).
            max_steps=int(os.getenv("SHADOW_MAX_TRAJECTORY", "15")),
            # How many recent screenshots Agent-S keeps in its context window.
            traj_window=int(os.getenv("SHADOW_TRAJ_WINDOW", "5")),
            action_delay=float(os.getenv("SHADOW_ACTION_DELAY", "0.4")),
            # Local HTTP endpoint for middleware to POST instructions.
            http_host=os.getenv("SHADOW_HTTP_HOST", "127.0.0.1").strip(),
            http_port=int(os.getenv("SHADOW_HTTP_PORT", "8765")),
            http_token=os.getenv("SHADOW_HTTP_TOKEN", "").strip(),
            # UI-TARS coordinate space (the grounding model reasons at this resolution).
            grounding_width=int(os.getenv("SHADOW_GROUNDING_WIDTH", "1920")),
            grounding_height=int(os.getenv("SHADOW_GROUNDING_HEIGHT", "1080")),
        )

    def missing_keys(self) -> list[str]:
        """Human-readable list of any required keys that are absent."""
        missing = []
        if not self.anthropic_api_key:
            missing.append("ANTHROPIC_API_KEY (Claude planner)")
        if not self.openrouter_api_key:
            missing.append("OPENROUTER_API_KEY (UI-TARS grounding)")
        return missing

    def generation_engine_params(self) -> dict:
        """Engine config for the Claude planner."""
        return {
            "engine_type": "anthropic",
            "model": self.gen_model,
            "api_key": self.anthropic_api_key,
        }

    def grounding_engine_params(self, grounding_width: int = 0, grounding_height: int = 0) -> dict:
        """Engine config for UI-TARS grounding, served by OpenRouter.

        UI-TARS-1.5 returns coordinates in the *input image's* pixel space, so
        grounding_width/height must match the dimensions of the screenshot we
        actually send — otherwise Agent-S rescales correct coordinates and the
        click lands in the wrong place. Callers pass the real sent-image size.
        """
        return {
            "engine_type": "open_router",
            "model": self.ground_model,
            "base_url": OPENROUTER_BASE_URL,
            "api_key": self.openrouter_api_key,
            "grounding_width": grounding_width or self.grounding_width,
            "grounding_height": grounding_height or self.grounding_height,
        }
