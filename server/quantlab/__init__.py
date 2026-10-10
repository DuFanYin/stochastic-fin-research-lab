"""Quant Lab as a Python library: every tool of the lab, computed in-process by the C++ engine.

    import quantlab
    r = quantlab.price_option(spot=100, strike=105, rate=0.03, vol=0.2, maturity=0.5)
    r["result_summary"]["bs"], r["result_summary"]["greeks"]["delta_bs"]
    quantlab.list_tools()                 # name -> title
    print(quantlab.describe("screen_strategies"))
    await quantlab.acall("option_chain", currency="BTC", max_days=30)   # inside an event loop

Every result is the envelope the HTTP API and the MCP server return: result_summary, result_details, warnings,
diagnostics, input_params, run_id. A tool that cannot answer raises quantlab.ToolError; bad arguments raise
pydantic.ValidationError.
"""

import asyncio
import inspect

from quantlab.version import CONTRACT_VERSION, __version__


def _registry():
    from quantlab.tools import TOOLS  # here, not at import: the engine client imports quantlab.version
    return TOOLS


async def acall(name: str, arguments: dict | None = None, /, **kwargs) -> dict:
    """Runs a tool inside a running event loop."""
    from quantlab.tools import call as call_tool
    return await call_tool(name, {**(arguments or {}), **kwargs})


def call(name: str, arguments: dict | None = None, /, **kwargs) -> dict:
    """Runs a tool and waits for it (outside an event loop; inside one, await acall)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:
        raise RuntimeError("quantlab.call cannot run inside an event loop: await quantlab.acall(...) instead")

    async def run():
        from quantlab.services import market_data
        try:
            return await acall(name, arguments, **kwargs)
        finally:
            await market_data.close()
    return asyncio.run(run())


def list_tools() -> dict[str, str]:
    """The tools, name -> title."""
    return {name: t.title for name, t in _registry().items()}


def describe(name: str) -> str:
    """A tool's description and its parameters."""
    t = _registry()[name]
    lines = [f"{t.name}: {t.title}", "", t.description, "", "Parameters:"]
    for field, info in t.input.model_fields.items():
        default = "required" if info.is_required() else f"default {info.get_default(call_default_factory=True)!r}"
        lines.append(f"  {field} ({default}): {info.description or ''}")
    return "\n".join(lines)


def _tool_function(name: str):
    t = _registry()[name]

    def function(**arguments) -> dict:
        return call(name, arguments)
    function.__name__ = function.__qualname__ = name
    function.__doc__ = describe(name)
    function.__signature__ = inspect.Signature([
        inspect.Parameter(field, inspect.Parameter.KEYWORD_ONLY, annotation=info.annotation,
                          default=inspect.Parameter.empty if info.is_required() else info.get_default(call_default_factory=True))
        for field, info in t.input.model_fields.items()])
    return function


def __getattr__(name: str):
    if not name.startswith("_") and name in _registry():
        return _tool_function(name)
    if name == "ToolError":
        from quantlab.tools import ToolError
        return ToolError
    raise AttributeError(f"module 'quantlab' has no attribute {name!r}")


def __dir__():
    return sorted([*globals(), "ToolError", *_registry()])


__all__ = ["CONTRACT_VERSION", "__version__", "acall", "call", "describe", "list_tools"]
