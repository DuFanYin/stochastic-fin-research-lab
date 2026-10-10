"""The lab's tools over the Model Context Protocol, for agents.

- stdio: `quantlab mcp` (or `quantlab-mcp`) runs a server for one agent, e.g. in Claude Code:
  `claude mcp add quantlab -- quantlab mcp`.
- Streamable HTTP at /mcp of the lab's server (the public lab: https://dufanyin.dev/lab/mcp), stateless with JSON
  responses: every request is answered on its own, so it works behind any proxy.

The tools are the registry's (quantlab.tools): their descriptions and input schemas are what the agent reads. A tool
that cannot answer returns isError with the reason, so the agent can correct its arguments. Long lists in a result are
cut to LIST_LIMIT items, said so in place, to keep the result within an agent's context.
"""

import json
from contextlib import asynccontextmanager

import anyio
import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import ValidationError

from quantlab.tools import TOOLS, ToolError, run_tool
from quantlab.version import __version__

LIST_LIMIT = 40
PUBLIC_URL = "https://dufanyin.dev/lab/"

INSTRUCTIONS = """Quant Lab prices, calibrates, stresses, hedges and screens options with a C++ engine.

Units: rates, vols, yields and drifts are decimals per year (0.05 = 5%); maturities are in years; prices are in the units of
spot (USD for BTC and ETH). Every result has result_summary (the headline numbers), result_details (tables and curves),
warnings (read them: they say when a number is less trustworthy, e.g. a stale chain or a failed check) and diagnostics.

Typical flows:
- a BTC option: market_snapshot for spot, vol and rate, then price_option;
- a trade idea: screen_strategies, then price_strategy or stress_test on a strategy's legs;
- a doubtful number: validate with the relevant checks, or benchmark_methods / lattice_convergence to see the numerical error.
"""


def compact(value, limit: int = LIST_LIMIT):
    """The value with every list longer than `limit` cut to its first `limit` items and a note of how many were left out."""
    if isinstance(value, dict):
        return {k: compact(v, limit) for k, v in value.items()}
    if isinstance(value, list):
        head = [compact(v, limit) for v in value[:limit]]
        return head + [f"… {len(value) - limit} more not shown"] if len(value) > limit else head
    return value


def _error(message: str) -> types.CallToolResult:
    return types.CallToolResult(content=[types.TextContent(text=message)], is_error=True)


async def list_tools(ctx, params) -> types.ListToolsResult:
    return types.ListToolsResult(tools=[
        types.Tool(name=t.name, title=t.title, description=t.description, input_schema=t.schema(),
                   annotations=types.ToolAnnotations(read_only_hint=True, idempotent_hint=True, open_world_hint=t.network))
        for t in TOOLS.values()
    ])


async def call_tool(ctx, params: types.CallToolRequestParams) -> types.CallToolResult:
    tool = TOOLS.get(params.name)
    if tool is None:
        return _error(f"no tool named {params.name!r}; the tools are: {', '.join(TOOLS)}")
    try:
        result = await run_tool(tool, tool.input.model_validate(params.arguments or {}))
    except ValidationError as exc:
        problems = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'arguments'}: {e['msg']}" for e in exc.errors())
        return _error(f"invalid arguments for {tool.name}: {problems}")
    except ToolError as exc:
        return _error(exc.message)
    data = compact(result)
    return types.CallToolResult(content=[types.TextContent(text=json.dumps(data, separators=(",", ":")))],
                                structured_content=data)


server = Server("quantlab", version=__version__, title="Quant Lab",
                description="Option pricing, calibration, risk, numerics and a live BTC / ETH options screener.",
                instructions=INSTRUCTIONS, website_url=PUBLIC_URL, on_list_tools=list_tools, on_call_tool=call_tool)


class HttpEndpoint:
    """The ASGI app at /mcp. `running()` belongs in the web server's lifespan: it starts the session manager (a fresh
    one each time, so the app can be started again, as tests do)."""

    def __init__(self):
        self.manager: StreamableHTTPSessionManager | None = None

    @asynccontextmanager
    async def running(self):
        # The tools only compute and read public data, and the lab runs behind proxies under other host names, so
        # requests are not held to a list of hosts.
        self.manager = StreamableHTTPSessionManager(
            app=server, json_response=True, stateless=True,
            security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False))
        try:
            async with self.manager.run():
                yield
        finally:
            self.manager = None

    async def __call__(self, scope, receive, send):
        if self.manager is None:
            await send({"type": "http.response.start", "status": 503, "headers": [(b"content-type", b"text/plain")]})
            await send({"type": "http.response.body", "body": b"the MCP endpoint is not running"})
            return
        await self.manager.handle_request(scope, receive, send)


def serve_stdio() -> None:
    """Serves the tools to one agent over stdin and stdout until it hangs up."""
    async def main():
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())
    anyio.run(main)
