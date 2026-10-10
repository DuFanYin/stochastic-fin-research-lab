"""The agent toolkit: one registry of tools behind every interface (Python, HTTP, MCP on stdio and HTTP, CLI, llms.txt),
each tool documented well enough for a model to call it from its schema alone, and one envelope for every result.

Run:  server/.venv/bin/python -m pytest tests/test_agent_toolkit.py   (offline: market data is faked to fail)
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mcp import Client  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import main  # noqa: E402
import quantlab  # noqa: E402
from quantlab.mcp import LIST_LIMIT, compact, server  # noqa: E402
from quantlab.services import engine_client, market_data  # noqa: E402
from quantlab.tools import TOOLS, ToolError, call  # noqa: E402
from quantlab.version import CONTRACT_VERSION  # noqa: E402

ENVELOPE = {"contract_version", "run_id", "tool", "status", "input_params", "result_summary", "result_details",
            "warnings", "diagnostics", "created_at"}
MCP_HEADERS = {"accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18"}


@pytest.fixture()
def offline():
    """No market data: every fetch fails, so the tools fall back (to the recorded chains, to fixed values)."""
    def refuse(request):
        raise httpx.ConnectError("offline", request=request)
    saved_http, saved_home = market_data._http, os.environ.get("QUANT_LAB_HOME")
    client = httpx.AsyncClient(transport=httpx.MockTransport(refuse))
    market_data._http = lambda slow=False: client
    home = tempfile.TemporaryDirectory()
    os.environ["QUANT_LAB_HOME"] = home.name
    market_data._CHAIN_MEMO.clear()
    yield
    market_data._http = saved_http
    market_data._CHAIN_MEMO.clear()
    os.environ.pop("QUANT_LAB_HOME") if saved_home is None else os.environ.__setitem__("QUANT_LAB_HOME", saved_home)
    home.cleanup()


def undocumented(model: type[BaseModel], prefix="") -> list[str]:
    """Fields of a model (and of the models inside it) without a description."""
    missing = []
    for name, info in model.model_fields.items():
        if not info.description:
            missing.append(prefix + name)
        for arg in getattr(info.annotation, "__args__", ()) + (info.annotation,):
            if isinstance(arg, type) and issubclass(arg, BaseModel):
                missing += undocumented(arg, f"{prefix}{name}.")
    return missing


def test_every_tool_is_documented_for_a_model():
    paths = [(t.method, t.path) for t in TOOLS.values()]
    assert len(set(paths)) == len(paths) == len(TOOLS) >= 26
    for t in TOOLS.values():
        assert t.name.isidentifier() and t.title and len(t.description) >= 80, t.name
        assert undocumented(t.input) == [], (t.name, undocumented(t.input))
        t.input.model_validate(t.example)
        assert t.schema()["examples"] == [t.example]


def test_every_example_runs_and_returns_the_envelope(offline):
    for t in TOOLS.values():
        r = asyncio.run(call(t.name, t.example))
        assert set(r) == ENVELOPE and r["status"] == "ok" and r["tool"] == t.name, t.name
        assert r["contract_version"] == CONTRACT_VERSION
        json.dumps(r, allow_nan=False)  # no NaN or infinity reaches a client
    chain = asyncio.run(call("option_chain", {"currency": "BTC"}))
    assert chain["result_summary"]["source"] == "fixture" and any("fixture" in w for w in chain["warnings"])
    assert chain["result_summary"]["chain_quality"]["options"] == chain["result_summary"]["n_options"]


def test_errors_say_what_is_wrong():
    with pytest.raises(ToolError) as e:
        asyncio.run(call("no_such_tool"))
    assert e.value.status == 404 and "price_option" in e.value.message
    r = asyncio.run(call("scenario_sweep", {**TOOLS["scenario_sweep"].example, "option_type": "put"}))
    assert any("call" in w for w in r["warnings"])


def test_the_engine_speaks_the_same_contract():
    assert engine_client.is_engine_available() and engine_client.ENGINE_PROBLEM == ""
    r = engine_client.run_engine_task("pricing", {"spot": 100, "strike": 100, "rate": 0.03, "vol": 0.2, "maturity": 1})
    assert r["contract_version"] == CONTRACT_VERSION


def test_python_api():
    r = quantlab.price_option(spot=100, strike=105, rate=0.03, vol=0.2, maturity=0.5)
    assert abs(r["result_summary"]["bs"] - 4.1783) < 1e-3
    assert "spot" in str(__import__("inspect").signature(quantlab.price_option))
    assert set(quantlab.list_tools()) == set(TOOLS) and "Parameters:" in quantlab.describe("validate")

    async def inside_a_loop():
        with pytest.raises(RuntimeError):
            quantlab.call("price_option", spot=100)
        return await quantlab.acall("implied_vol", spot=100, strike=100, rate=0.03, maturity=0.5, market_price=6.5)
    assert asyncio.run(inside_a_loop())["result_summary"]["converged"]


def test_http_api():
    with TestClient(main.app) as c:
        listed = c.get("/api/tools").json()
        assert [t["name"] for t in listed["tools"]] == list(TOOLS) and listed["contract_version"] == CONTRACT_VERSION
        assert all(t["input_schema"]["properties"] for t in listed["tools"] if t["name"] not in ("stress_packs", "market_snapshot"))
        ex = TOOLS["price_option"].example
        by_name, by_path = c.post("/api/tools/price_option", json=ex).json(), c.post("/api/tool/pricing/run", json=ex).json()
        assert by_name["result_summary"]["bs"] == by_path["result_summary"]["bs"] and set(by_path) == ENVELOPE
        assert c.get("/api/tool/stress/packs").json()["result_summary"]["packs"]
        assert c.post("/api/tools/nope", json={}).status_code == 404
        assert c.post("/api/tools/price_option", json={"spot": -1}).status_code == 422
        assert c.post("/api/tool/screener/run", json={"strategies": {}}).json()["detail"] == "select at least one strategy type"
        assert c.get("/api/health").json() == {"status": "ok", "version": quantlab.__version__,
                                               "contract_version": CONTRACT_VERSION, "engine": "ok"}
        text = c.get("/llms.txt").text
    assert all(f"- {name}:" in text for name in TOOLS) and "/mcp" in text


def test_mcp_in_process():
    async def run():
        async with Client(server) as c:
            tools = (await c.list_tools()).tools
            assert [t.name for t in tools] == list(TOOLS)
            assert all(t.description and t.input_schema["type"] == "object" for t in tools)
            ok = await c.call_tool("compare_hedges", TOOLS["compare_hedges"].example)
            assert not ok.is_error and set(ok.structured_content) == ENVELOPE
            assert json.loads(ok.content[0].text) == ok.structured_content
            bad = await c.call_tool("price_option", {"spot": 100})
            assert bad.is_error and "strike: Field required" in bad.content[0].text
            unknown = await c.call_tool("price_everything", {})
            assert unknown.is_error and "no tool named" in unknown.content[0].text
    asyncio.run(run())


def test_mcp_over_http_is_stateless():
    with TestClient(main.app) as c:
        rpc = lambda i, method, params: c.post("/mcp", headers=MCP_HEADERS,
                                                json={"jsonrpc": "2.0", "id": i, "method": method, "params": params})
        init = rpc(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                     "clientInfo": {"name": "test", "version": "0"}}).json()
        assert init["result"]["serverInfo"]["name"] == "quantlab" and "tools" in init["result"]["capabilities"]
        listed = rpc(2, "tools/list", {}).json()["result"]["tools"]
        assert len(listed) == len(TOOLS)
        r = rpc(3, "tools/call", {"name": "implied_vol", "arguments": TOOLS["implied_vol"].example}).json()["result"]
        assert not r["isError"] and r["structuredContent"]["result_summary"]["converged"]


def test_long_lists_are_cut_for_agents():
    value = compact({"rows": list(range(LIST_LIMIT + 5)), "short": [1, 2]})
    assert value["rows"][:LIST_LIMIT] == list(range(LIST_LIMIT)) and value["rows"][-1] == "… 5 more not shown"
    assert value["short"] == [1, 2]


def test_cli():
    run = lambda *args, **kw: subprocess.run([sys.executable, "-m", "quantlab", *args], cwd=ROOT / "server",
                                              capture_output=True, text=True, timeout=120, **kw)
    ok = run("price_option", "--spot", "100", "--strike", "105", "--rate", "0.03", "--vol", "0.2", "--maturity", "0.5", "--summary")
    assert ok.returncode == 0 and abs(json.loads(ok.stdout)["result_summary"]["bs"] - 4.1783) < 1e-3
    piped = run("implied_vol", "--input", "-", "--summary", input=json.dumps(TOOLS["implied_vol"].example))
    assert piped.returncode == 0 and json.loads(piped.stdout)["result_summary"]["converged"]
    bad = run("price_option", "--spot", "-1")
    assert bad.returncode == 2 and "spot: Input should be greater than 0" in bad.stderr
    assert run("list").stdout.count("\n") == len(TOOLS)
