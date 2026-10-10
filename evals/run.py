"""Runs the agent tasks (evals/tasks.py) with Claude using the lab's tools, and checks the answers.

    ANTHROPIC_API_KEY=... server/.venv/bin/python evals/run.py [--model claude-sonnet-5-5] [--task bs_price] [--live]

The model gets every tool of the registry with its description and input schema (as over MCP), the tools run in-process,
and the answer is checked against the truth the tools compute. When a task fails, the tool's description or error message
is what to improve. Live tasks (the Deribit chain) run only with --live.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(ROOT))

import httpx  # noqa: E402
from pydantic import ValidationError  # noqa: E402

import quantlab  # noqa: E402
from evals.tasks import TASKS, Task  # noqa: E402
from quantlab.mcp import INSTRUCTIONS, compact  # noqa: E402
from quantlab.tools import TOOLS, ToolError  # noqa: E402

API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-5-5"
MAX_TURNS = 12
SYSTEM = INSTRUCTIONS + "\nUse the tools for every number. Finish with a short answer that states the numbers asked for."


def tool_definitions() -> list[dict]:
    return [{"name": t.name, "description": t.description, "input_schema": t.input.model_json_schema()} for t in TOOLS.values()]


async def run_tool(name: str, arguments: dict) -> tuple[str, bool]:
    try:
        return json.dumps(compact(await quantlab.acall(name, arguments)), separators=(",", ":")), False
    except ToolError as exc:
        return exc.message, True
    except ValidationError as exc:
        return f"invalid arguments: {exc}", True


async def ask(task: Task, client: httpx.AsyncClient, model: str) -> tuple[str, list[str]]:
    """The model's final answer to a task, and the tools it called."""
    messages, called = [{"role": "user", "content": task.prompt}], []
    for _ in range(MAX_TURNS):
        r = await client.post(API, json={"model": model, "max_tokens": 2048, "system": SYSTEM, "tools": tool_definitions(),
                                         "messages": messages})
        r.raise_for_status()
        reply = r.json()
        messages.append({"role": "assistant", "content": reply["content"]})
        uses = [b for b in reply["content"] if b["type"] == "tool_use"]
        if reply.get("stop_reason") != "tool_use" or not uses:
            return "".join(b.get("text", "") for b in reply["content"] if b["type"] == "text"), called
        results = []
        for use in uses:
            called.append(use["name"])
            content, is_error = await run_tool(use["name"], use["input"])
            results.append({"type": "tool_result", "tool_use_id": use["id"], "content": content, "is_error": is_error})
        messages.append({"role": "user", "content": results})
    return "", called


async def evaluate(tasks: list[Task], client: httpx.AsyncClient, model: str) -> list[dict]:
    rows = []
    for task in tasks:
        answer, called = await ask(task, client, model)
        truth = await asyncio.to_thread(task.truth)
        rows.append({"task": task.id, "passed": task.check(answer, truth), "truth": truth, "tools": called, "answer": answer})
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--task", action="append", help="run only this task (repeatable)")
    parser.add_argument("--live", action="store_true", help="include the tasks that read the live chain")
    args = parser.parse_args()
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("set ANTHROPIC_API_KEY to run the evals", file=sys.stderr)
        return 2
    tasks = [t for t in TASKS if (not args.task or t.id in args.task) and (args.live or not t.live)]

    async def run():
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01"}
        async with httpx.AsyncClient(headers=headers, timeout=300) as client:
            return await evaluate(tasks, client, args.model)
    rows = asyncio.run(run())
    for r in rows:
        print(f"{'PASS' if r['passed'] else 'FAIL'}  {r['task']:18s} tools: {', '.join(r['tools']) or '–'}")
        if not r["passed"]:
            print(f"      truth {r['truth']!r}; answer: {r['answer'][:300]!r}")
    print(f"\n{sum(r['passed'] for r in rows)}/{len(rows)} passed with {args.model}")
    return 0 if all(r["passed"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
