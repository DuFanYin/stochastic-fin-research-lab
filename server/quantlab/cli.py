"""The command line, for people and for agents that work in a shell.

    quantlab list                          the tools
    quantlab describe price_option         a tool's description and parameters
    quantlab price_option --spot 100 --strike 105 --rate 0.03 --vol 0.2 --maturity 0.5
    quantlab screen_strategies --input request.json --summary
    quantlab serve --port 8000             the HTTP server: the workbench, /api, /mcp, /llms.txt
    quantlab mcp                           MCP over stdio (for an agent: claude mcp add quantlab -- quantlab mcp)

A parameter's value is read as JSON when it parses (numbers, true / false, lists, objects) and as text otherwise.
--input takes the arguments as a JSON object from a file (or - for stdin); flags given as well override it. The result is
printed as JSON, lists cut to 40 items unless --full; --summary prints only result_summary and warnings.
"""

import argparse
import json
import sys
from pathlib import Path

import quantlab
from quantlab.mcp import compact


def _value(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def _run(tool: str, argv: list[str]) -> int:
    from pydantic import ValidationError

    from quantlab.tools import TOOLS, ToolError
    model = TOOLS[tool].input
    parser = argparse.ArgumentParser(prog=f"quantlab {tool}", description=TOOLS[tool].description)
    parser.add_argument("--input", help="arguments as a JSON object, from a file or - for stdin")
    parser.add_argument("--full", action="store_true", help="print every list in full")
    parser.add_argument("--summary", action="store_true", help="print only result_summary and warnings")
    for field, info in model.model_fields.items():
        flags = [f"--{field}"] + ([f"--{field.replace('_', '-')}"] if "_" in field else [])
        parser.add_argument(*flags, dest=field, type=_value, default=argparse.SUPPRESS,
                            help=(info.description or "").replace("%", "%%"))
    args = vars(parser.parse_args(argv))
    arguments = {}
    if (source := args.pop("input", None)) is not None:
        arguments = json.loads(sys.stdin.read() if source == "-" else Path(source).read_text())
    full, summary = args.pop("full"), args.pop("summary")
    arguments.update(args)
    try:
        result = quantlab.call(tool, arguments)
    except ValidationError as exc:
        for e in exc.errors():
            print(f"{'.'.join(map(str, e['loc'])) or 'arguments'}: {e['msg']}", file=sys.stderr)
        return 2
    except ToolError as exc:
        print(exc.message, file=sys.stderr)
        return 1
    if summary:
        result = {"result_summary": result["result_summary"], "warnings": result["warnings"]}
    print(json.dumps(result if full else compact(result), indent=2, ensure_ascii=False))
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    tools = quantlab.list_tools()
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.strip() + "\n\nTools:\n" + "\n".join(f"  {name:20s} {title}" for name, title in tools.items()))
        return 0
    command, rest = argv[0], argv[1:]
    if command == "list":
        print("\n".join(f"{name:20s} {title}" for name, title in tools.items()))
        return 0
    if command == "describe":
        if not rest or rest[0] not in tools:
            print("usage: quantlab describe <tool>; quantlab list shows them", file=sys.stderr)
            return 2
        print(quantlab.describe(rest[0]))
        return 0
    if command == "serve":
        parser = argparse.ArgumentParser(prog="quantlab serve")
        parser.add_argument("--host", default="127.0.0.1")
        parser.add_argument("--port", type=int, default=8000)
        args = parser.parse_args(rest)
        import uvicorn
        uvicorn.run("quantlab.http:app", host=args.host, port=args.port)
        return 0
    if command == "mcp":
        from quantlab.mcp import serve_stdio
        serve_stdio()
        return 0
    if command in tools:
        return _run(command, rest)
    print(f"unknown command {command!r}: quantlab list shows the tools", file=sys.stderr)
    return 2


def mcp_main() -> None:
    """The quantlab-mcp entry point: MCP over stdio."""
    from quantlab.mcp import serve_stdio
    serve_stdio()


if __name__ == "__main__":
    sys.exit(main())
