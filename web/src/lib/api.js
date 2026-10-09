// The server's API, relative to the page: the workbench runs under any path prefix (dufanyin.dev/lab/).
import { signal } from "@preact/signals";

const BASE = new URL("api", document.baseURI).href;

/** Seconds of computing time left on the public lab (its x-lab-budget header); null where there is no limit. */
export const budget = signal(null);

async function detail(res) {
  try {
    const d = await res.json();
    return typeof d?.detail === "string" ? d.detail : JSON.stringify(d?.detail ?? d);
  } catch {
    return "";
  }
}

async function request(method, path, body) {
  const res = await fetch(BASE + path, body === undefined ? { method } : {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const left = res.headers.get("x-lab-budget");
  if (left !== null) budget.value = Number(left);
  if (!res.ok) {
    const why = await detail(res);
    throw new Error(`${res.status}${why ? `: ${why}` : ""} (${method} ${path.split("?")[0]})`);
  }
  return res.json();
}

export const get = (path) => request("GET", path);
export const post = (path, body) => request("POST", path, body);
