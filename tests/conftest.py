"""Every test session runs with its own QUANT_LAB_HOME, so no test reads or writes the user's: cached chains, the run
history, the saved Treasury curve (tests that need a home of their own still set one)."""

import os
import tempfile

_home = tempfile.TemporaryDirectory(prefix="quant-lab-tests-")
os.environ["QUANT_LAB_HOME"] = _home.name
