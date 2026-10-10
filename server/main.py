"""The server run.sh and the systemd units start (uvicorn main:app, from this folder): the app is quantlab.http."""

from quantlab.http import app  # noqa: F401
