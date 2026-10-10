"""Where the lab keeps its files, and how a deployment is configured.

$QUANT_LAB_HOME (default ~/.quant-lab) holds the cached option chains (chains/), the run history (runs.db), the saved
Treasury curve (rates.json) and the deployment's config.json, for example:
    {"public": true, "runs": {"max_runs": 5000, "max_days": 7}}
"""

import json
import os
from pathlib import Path


def home() -> Path:
    return Path(os.environ.get("QUANT_LAB_HOME", Path.home() / ".quant-lab"))


def config() -> dict:
    try:
        return json.loads((home() / "config.json").read_text())
    except (OSError, ValueError):
        return {}


def public() -> bool:
    """A public deployment: a run is found only by its id, never listed or deleted (it would show everyone's)."""
    return bool(config().get("public"))
