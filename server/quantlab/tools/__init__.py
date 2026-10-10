"""Every tool of the lab, by name, in the order they are listed to agents."""

from quantlab.tools import calibration, greeks, hedging, market, pricing, screener, strategy, stress, theory
from quantlab.tools.base import Result, Tool, ToolError, run_tool

TOOLS: dict[str, Tool] = {t.name: t for module in (pricing, strategy, greeks, calibration, stress, hedging, market,
                                                    screener, theory) for t in module.TOOLS}


async def call(name: str, arguments: dict | None = None) -> dict:
    """Runs the tool `name` on `arguments` (validated against its input model) and returns the envelope.
    Raises ToolError for an unknown tool or one that cannot answer, pydantic.ValidationError for bad arguments."""
    tool = TOOLS.get(name)
    if tool is None:
        raise ToolError(f"no tool named {name!r}; the tools are: {', '.join(TOOLS)}", 404)
    return await run_tool(tool, tool.input.model_validate(arguments or {}))


__all__ = ["TOOLS", "Result", "Tool", "ToolError", "call"]
