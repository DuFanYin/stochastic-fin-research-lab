import { API_BASE } from "./config.js";

async function readErrorDetail(res) {
  try {
    const data = await res.json();
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) return JSON.stringify(data.detail);
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

export async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`GET ${path} failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return res.json();
}

export async function postJson(path, payload) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`POST ${path} failed: ${res.status}${detail ? ` - ${detail}` : ""}`);
  }
  return res.json();
}
