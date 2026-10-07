function num(v, fallback = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function normalize(values) {
  const nums = values.map((v) => num(v));
  const maxAbs = Math.max(...nums.map((v) => Math.abs(v)), 1e-12);
  return { nums, maxAbs };
}

function fmtTick(value) {
  if (value === null || value === undefined) return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 0.001)) return n.toExponential(3);
  return Number(n.toFixed(5)).toString();
}

export function sparkline(values, w = 320, h = 48) {
  if (!values || !values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1 || 1);
  const pts = values.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="1.5" />
  </svg>`;
}

export function timingsBar(timings, w = 320, h = 40) {
  if (!timings || !timings.length) return "";
  const max = Math.max(...timings) || 1;
  const bw = w / timings.length;
  const bars = timings.map((t, i) => {
    const bh = (t / max) * h;
    return `<rect x="${i * bw}" y="${h - bh}" width="${bw - 1}" height="${bh}" fill="var(--brand)" opacity="0.7" />`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${bars}</svg>`;
}

export function groupedBarChart(rows, keys, opts = {}) {
  if (!rows?.length || !keys?.length) return "";
  const w = opts.w ?? 560;
  const h = opts.h ?? 180;
  const pad = 24;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const values = rows.flatMap((r) => keys.map((k) => num(r?.[k])));
  const { maxAbs } = normalize(values);
  const groupW = innerW / rows.length;
  const barW = Math.max(4, (groupW - 6) / keys.length);
  const colors = ["#8e8e8e", "#b0b0b0", "#d2d2d2", "#6f6f6f"];
  const bars = [];
  rows.forEach((row, gi) => {
    keys.forEach((k, ki) => {
      const v = num(row?.[k]);
      const bh = (Math.abs(v) / maxAbs) * innerH;
      const x = pad + gi * groupW + 3 + ki * barW;
      const y = pad + (innerH - bh);
      bars.push(`<rect x="${x}" y="${y}" width="${Math.max(2, barW - 2)}" height="${bh}" fill="${colors[ki % colors.length]}" opacity="0.85" />`);
    });
  });
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <line x1="${pad}" y1="${pad + innerH}" x2="${pad + innerW}" y2="${pad + innerH}" stroke="#6a6a6a" stroke-width="1" />
    ${bars.join("")}
  </svg>`;
}

export function lineChart(points, opts = {}) {
  if (!points?.length) return "";
  const w = opts.w ?? 560;
  const h = opts.h ?? 180;
  const pad = 24;
  const xs = points.map((p) => num(p?.x));
  const ys = points.map((p) => num(p?.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const pts = points.map((p) => {
    const x = pad + ((num(p?.x) - minX) / dx) * (w - pad * 2);
    const y = h - pad - ((num(p?.y) - minY) / dy) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <polyline points="${pts}" fill="none" stroke="#c9c9c9" stroke-width="1.8" />
  </svg>`;
}

export function dualLineChart(seriesA, seriesB, opts = {}) {
  const n = Math.min(seriesA?.length || 0, seriesB?.length || 0);
  if (!n) return "";
  const w = opts.w ?? 560;
  const h = opts.h ?? 180;
  const pad = 24;
  const xs = Array.from({ length: n }, (_, i) => i);
  const allY = [...seriesA.slice(0, n), ...seriesB.slice(0, n)].map((v) => num(v));
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const dy = maxY - minY || 1;
  const dx = (n - 1) || 1;
  const mk = (arr) => xs.map((x, i) => {
    const px = pad + (x / dx) * (w - pad * 2);
    const py = h - pad - ((num(arr[i]) - minY) / dy) * (h - pad * 2);
    return `${px},${py}`;
  }).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <polyline points="${mk(seriesA)}" fill="none" stroke="#d6d6d6" stroke-width="1.8" />
    <polyline points="${mk(seriesB)}" fill="none" stroke="#7f7f7f" stroke-width="1.8" />
  </svg>`;
}

export function tornadoChart(rows, opts = {}) {
  if (!rows?.length) return "";
  const w = opts.w ?? 560;
  const h = Math.max(120, rows.length * 24 + 24);
  const cx = w / 2;
  const pad = 16;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(num(r?.value))), 1e-12);
  const bwMax = (w / 2) - 90;
  const bars = rows.map((r, i) => {
    const v = num(r?.value);
    const bw = (Math.abs(v) / maxAbs) * bwMax;
    const y = pad + i * 24;
    const x = v >= 0 ? cx : (cx - bw);
    const fill = v >= 0 ? "#b8b8b8" : "#6f6f6f";
    return `<rect x="${x}" y="${y}" width="${bw}" height="16" fill="${fill}" opacity="0.9" />`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <line x1="${cx}" y1="6" x2="${cx}" y2="${h - 6}" stroke="#7a7a7a" stroke-width="1" />
    ${bars}
  </svg>`;
}

let _ivChartId = 0;

// ── Term Structure ────────────────────────────────────────────────────────────

function _drawTermStructure(canvas, rows, opts = {}) {
  if (!canvas || !rows?.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 400;
  const aspectH = opts.aspectH ?? 0.36;
  const h = Math.round(w * aspectH);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const padL = 52, padR = 20, padT = 16, padB = 36;
  const iW = w - padL - padR;
  const iH = h - padT - padB;

  const sorted = [...rows].sort((a, b) => Number(a.years) - Number(b.years));
  const xs = sorted.map((r) => Number(r.years));
  const ys = sorted.map((r) => Number(r.iv) * 100);
  const minX = xs[0], maxX = xs[xs.length - 1], spanX = Math.max(maxX - minX, 1e-9);
  const padding = Math.max(0.5, (Math.max(...ys) - Math.min(...ys)) * 0.15);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxY = Math.max(...ys) + padding;
  const spanY = Math.max(maxY - minY, 1e-9);
  const toX = (v) => padL + ((v - minX) / spanX) * iW;
  const toY = (v) => padT + (1 - (v - minY) / spanY) * iH;

  // grid lines
  ctx.strokeStyle = "rgba(120,120,120,0.25)";
  ctx.lineWidth = 1;
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = minY + (i / yTicks) * spanY;
    const y = toY(v);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iW, y); ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(v.toFixed(1) + "%", padL - 4, y + 3);
  }

  // vertical tick per data point
  xs.forEach((x) => {
    const px = toX(x);
    ctx.strokeStyle = "rgba(120,120,120,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + iH); ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(x.toFixed(2) + "y", px, padT + iH + 14);
  });

  // gradient area fill
  const grad = ctx.createLinearGradient(padL, padT, padL, padT + iH);
  grad.addColorStop(0, "rgba(139,92,246,0.12)");
  grad.addColorStop(1, "rgba(139,92,246,0)");
  ctx.beginPath();
  sorted.forEach((r, i) => {
    const px = toX(Number(r.years));
    const py = toY(Number(r.iv) * 100);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.lineTo(toX(xs[xs.length - 1]), padT + iH);
  ctx.lineTo(toX(xs[0]), padT + iH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  sorted.forEach((r, i) => {
    const px = toX(Number(r.years));
    const py = toY(Number(r.iv) * 100);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.strokeStyle = "rgba(139,92,246,0.85)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  // dots + labels
  const highlightExpiry = opts.highlightExpiry ?? null;
  sorted.forEach((r) => {
    const px = toX(Number(r.years));
    const py = toY(Number(r.iv) * 100);
    const expKey = r.expiry || String(Number(r.years).toFixed(4));
    const isHighlighted = highlightExpiry !== null && expKey === highlightExpiry;
    ctx.beginPath();
    ctx.arc(px, py, isHighlighted ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = isHighlighted ? "#c4b5fd" : "#8b5cf6";
    ctx.fill();
    ctx.strokeStyle = isHighlighted ? "rgba(196,181,253,0.9)" : "rgba(15,23,42,0.8)";
    ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
    ctx.stroke();
    ctx.fillStyle = isHighlighted ? "#e9d5ff" : "#d1d5db";
    ctx.font = isHighlighted ? "bold 9px monospace" : "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText((Number(r.iv) * 100).toFixed(1) + "%", px, py - 9);
  });

  // axis labels
  ctx.fillStyle = "#6b7280";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Maturity (years)", padL + iW / 2, h - 4);
  ctx.save();
  ctx.translate(12, padT + iH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("IV (%)", 0, 0);
  ctx.restore();
}

export function ivTermStructureChart(rows, opts = {}) {
  if (!rows?.length) return "";
  const id = `iv-term-${++_ivChartId}`;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    _drawTermStructure(canvas, rows, opts);
  });
  return `<canvas id="${id}" class="chart-canvas" style="width:100%;"></canvas>`;
}

export function redrawTermStructure(canvasId, rows, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  _drawTermStructure(canvas, rows, opts);
}

// ── Smile Chart ───────────────────────────────────────────────────────────────

function _drawSmile(canvas, rows, opts = {}) {
  if (!canvas || !rows?.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.offsetWidth || 400;
  const aspectH = opts.aspectH ?? 0.36;
  const h = Math.round(w * aspectH);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const padL = 52, padR = 20, padT = 16, padB = 36;
  const iW = w - padL - padR;
  const iH = h - padT - padB;

  const sorted = [...rows].sort((a, b) => Number(a.log_moneyness) - Number(b.log_moneyness));
  const xs = sorted.map((r) => Number(r.log_moneyness));
  const ys = sorted.map((r) => Number(r.iv) * 100);
  const minX = Math.min(...xs), maxX = Math.max(...xs), spanX = Math.max(maxX - minX, 1e-9);
  const padding = Math.max(0.5, (Math.max(...ys) - Math.min(...ys)) * 0.15);
  const minY = Math.max(0, Math.min(...ys) - padding);
  const maxY = Math.max(...ys) + padding;
  const spanY = Math.max(maxY - minY, 1e-9);
  const toX = (v) => padL + ((v - minX) / spanX) * iW;
  const toY = (v) => padT + (1 - (v - minY) / spanY) * iH;

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = minY + (i / yTicks) * spanY;
    const y = toY(v);
    ctx.strokeStyle = "rgba(120,120,120,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iW, y); ctx.stroke();
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(v.toFixed(1) + "%", padL - 4, y + 3);
  }

  if (minX < 0 && maxX > 0) {
    const atm = toX(0);
    ctx.strokeStyle = "rgba(200,200,200,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(atm, padT); ctx.lineTo(atm, padT + iH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText("ATM", atm, padT - 4);
  }

  const xTickCount = Math.min(sorted.length, 7);
  for (let i = 0; i < xTickCount; i++) {
    const idx = Math.round(i * (sorted.length - 1) / (xTickCount - 1));
    const r = sorted[idx];
    const px = toX(Number(r.log_moneyness));
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(Number(r.log_moneyness).toFixed(2), px, padT + iH + 14);
    const strike = Number(r.strike);
    if (strike > 0) ctx.fillText("$" + Math.round(strike / 1000) + "k", px, padT + iH + 25);
  }

  const grad = ctx.createLinearGradient(padL, padT, padL, padT + iH);
  grad.addColorStop(0, "rgba(139,92,246,0.18)");
  grad.addColorStop(1, "rgba(139,92,246,0)");
  ctx.beginPath();
  sorted.forEach((r, i) => {
    const px = toX(Number(r.log_moneyness));
    const py = toY(Number(r.iv) * 100);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.lineTo(toX(xs[xs.length - 1]), padT + iH);
  ctx.lineTo(toX(xs[0]), padT + iH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  sorted.forEach((r, i) => {
    const px = toX(Number(r.log_moneyness));
    const py = toY(Number(r.iv) * 100);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  });
  ctx.strokeStyle = "rgba(139,92,246,0.9)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke();

  sorted.forEach((r) => {
    const px = toX(Number(r.log_moneyness));
    const py = toY(Number(r.iv) * 100);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#a78bfa";
    ctx.fill();
  });

  ctx.fillStyle = "#6b7280";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Log-Moneyness  ln(K/S)", padL + iW / 2, h - 4);
  ctx.save();
  ctx.translate(12, padT + iH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("IV (%)", 0, 0);
  ctx.restore();
}

export function ivSmileChart(rows, opts = {}) {
  if (!rows?.length) return "";
  const id = `iv-smile-${++_ivChartId}`;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    _drawSmile(canvas, rows, opts);
  });
  return `<canvas id="${id}" class="chart-canvas" style="width:100%;"></canvas>`;
}

export function redrawSmile(canvasId, rows, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  _drawSmile(canvas, rows, opts);
}

// ── IV Heatmap ────────────────────────────────────────────────────────────────

export function ivHeatmap(rows, opts = {}) {
  if (!rows?.length) return "";
  const aspectH = opts.aspectH ?? 0.42;
  const id = `iv-heatmap-${++_ivChartId}`;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 400;
    const h = Math.round(w * aspectH);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const padL = 52, padR = 80, padT = 16, padB = 36;
    const iW = w - padL - padR;
    const iH = h - padT - padB;
    const ks = [...new Set(rows.map((r) => Number(r.k_ratio)))].sort((a, b) => a - b);
    const ts = [...new Set(rows.map((r) => Number(r.years)))].sort((a, b) => a - b);
    const ivs = rows.map((r) => Number(r.iv)).filter((v) => Number.isFinite(v));
    if (!ks.length || !ts.length || !ivs.length) return;
    const minIv = Math.min(...ivs);
    const maxIv = Math.max(...ivs);
    const spanIv = Math.max(maxIv - minIv, 1e-9);
    const kIndex = new Map(ks.map((k, i) => [k, i]));
    const tIndex = new Map(ts.map((t, i) => [t, i]));
    const grid = Array.from({ length: ts.length }, () => Array.from({ length: ks.length }, () => null));
    rows.forEach((r) => {
      const ki = kIndex.get(Number(r.k_ratio));
      const ti = tIndex.get(Number(r.years));
      if (ki == null || ti == null) return;
      grid[ti][ki] = r;
    });
    const cellW = iW / ks.length;
    const cellH = iH / ts.length;
    const colorOf = (iv, zone) => {
      if (zone === "burst_high") return [239, 68, 68];
      if (zone === "suppressed_low") return [96, 165, 250];
      const t = Math.max(0, Math.min(1, (iv - minIv) / spanIv));
      return [Math.round(20 + 200 * t), Math.round(130 - 80 * t), Math.round(220 - 100 * t)];
    };
    for (let ti = 0; ti < ts.length; ti++) {
      for (let ki = 0; ki < ks.length; ki++) {
        const p = grid[ti][ki];
        if (!p) continue;
        const x = padL + ki * cellW;
        const y = padT + (ts.length - 1 - ti) * cellH;
        const [r, g, b] = colorOf(Number(p.iv), p.zone);
        ctx.fillStyle = `rgba(${r},${g},${b},0.88)`;
        ctx.fillRect(x, y, Math.max(cellW - 0.5, 1), Math.max(cellH - 0.5, 1));
        if (cellW > 32 && cellH > 16) {
          ctx.fillStyle = "rgba(255,255,255,0.75)";
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.fillText((Number(p.iv) * 100).toFixed(1) + "%", x + cellW / 2, y + cellH / 2 + 3);
        }
      }
    }
    ctx.strokeStyle = "rgba(15,23,42,0.25)";
    ctx.lineWidth = 0.5;
    for (let ki = 0; ki <= ks.length; ki++) {
      const x = padL + ki * cellW;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + iH); ctx.stroke();
    }
    for (let ti = 0; ti <= ts.length; ti++) {
      const y = padT + ti * cellH;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iW, y); ctx.stroke();
    }
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ks.filter((_, i) => i === 0 || i === ks.length - 1 || i % Math.max(1, Math.floor(ks.length / 4)) === 0).forEach((k) => {
      const ki = kIndex.get(k);
      const x = padL + ki * cellW + cellW / 2;
      ctx.fillText(k.toFixed(2), x, padT + iH + 14);
    });
    ctx.textAlign = "right";
    ts.filter((_, i) => i === 0 || i === ts.length - 1 || i % Math.max(1, Math.floor(ts.length / 3)) === 0).forEach((t) => {
      const ti = tIndex.get(t);
      const y = padT + (ts.length - 1 - ti) * cellH + cellH / 2 + 3;
      ctx.fillText(t.toFixed(2) + "y", padL - 4, y);
    });
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText("K / S (moneyness)", padL + iW / 2, h - 4);
    const cbX = w - padR + 10;
    const cbH = iH;
    const cbW = 14;
    for (let i = 0; i <= cbH; i++) {
      const t = 1 - i / cbH;
      const iv = minIv + t * spanIv;
      const [r, g, b] = [Math.round(20 + 200 * t), Math.round(130 - 80 * t), Math.round(220 - 100 * t)];
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(cbX, padT + i, cbW, 1.5);
    }
    ctx.strokeStyle = "rgba(120,120,120,0.4)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cbX, padT, cbW, cbH);
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText((maxIv * 100).toFixed(1) + "%", cbX + cbW + 3, padT + 9);
    ctx.fillText((minIv * 100).toFixed(1) + "%", cbX + cbW + 3, padT + cbH);
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(cbX, padT + cbH + 6, cbW / 2 - 1, 8);
    ctx.fillStyle = "#60a5fa";
    ctx.fillRect(cbX + cbW / 2 + 1, padT + cbH + 6, cbW / 2 - 1, 8);
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px monospace";
    ctx.fillText("↑burst  suppress↑", cbX - 4, padT + cbH + 22);
  });
  return `<canvas id="${id}" class="chart-canvas" style="width:100%;"></canvas>`;
}

let _histId = 0;

export function pnlHistogramCanvas(histogram, opts = {}) {
  if (!histogram?.edges?.length || !histogram?.counts?.length) return "";
  const edges = histogram.edges;
  const counts = histogram.counts;
  const n = counts.length;
  const aspectH = opts.aspectH ?? 0.28;
  const padL = opts.padL ?? 8;
  const padR = opts.padR ?? 8;
  const padT = opts.padT ?? 8;
  const padB = opts.padB ?? 20;
  const q05 = opts.q05 ?? null;
  const q50 = opts.q50 ?? null;
  const q95 = opts.q95 ?? null;
  const id = `pnl-hist-${++_histId}`;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 400;
    const h = Math.round(w * aspectH);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);
    const lo = edges[0];
    const hi = edges[n];
    const xSpan = hi - lo || 1;
    const maxC = Math.max(...counts, 1);
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const toX = (v) => padL + ((v - lo) / xSpan) * innerW;
    const barW = innerW / n;
    ctx.strokeStyle = "rgba(120,120,120,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();
    counts.forEach((c, i) => {
      const bh = (c / maxC) * innerH;
      const x = padL + i * barW;
      const y = padT + innerH - bh;
      const mid = (edges[i] + edges[i + 1]) / 2;
      ctx.fillStyle = mid < 0 ? "rgba(200,100,100,0.65)" : "rgba(100,180,130,0.65)";
      ctx.fillRect(x + 0.5, y, Math.max(barW - 1, 1), bh);
    });
    const drawVLine = (v, color, label) => {
      if (v == null || v < lo || v > hi) return;
      const x = toX(v);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, padT + innerH + 13);
      ctx.restore();
    };
    drawVLine(q05, "rgba(200,120,80,0.9)", "q05");
    drawVLine(q50, "rgba(180,180,180,0.9)", "med");
    drawVLine(q95, "rgba(100,180,130,0.9)", "q95");
    if (lo < 0 && hi > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(200,200,200,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(toX(0), padT);
      ctx.lineTo(toX(0), padT + innerH);
      ctx.stroke();
      ctx.restore();
    }
  });
  return `<canvas id="${id}" class="chart-canvas" style="width:100%;"></canvas>`;
}

// ── Greek Surface Heatmap ─────────────────────────────────────────────────────
let _greekSurfaceId = 0;

export function greekSurfaceHeatmap(data, opts = {}) {
  // data: { greek, spots, maturities, grid (row-major spots×mats), grid_min, grid_max }
  if (!data?.spots?.length || !data?.maturities?.length || !data?.grid?.length) return "";
  const aspectH = opts.aspectH ?? 0.45;
  const id = `greek-surface-${++_greekSurfaceId}`;

  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 420;
    const h = Math.round(w * aspectH);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const padL = 54, padR = 80, padT = 20, padB = 38;
    const iW = w - padL - padR;
    const iH = h - padT - padB;

    const spots = data.spots;
    const mats  = data.maturities;
    const grid  = data.grid;
    const ns = spots.length;
    const nt = mats.length;
    if (ns < 2 || nt < 2) return;

    const gMin = data.grid_min ?? Math.min(...grid);
    const gMax = data.grid_max ?? Math.max(...grid);
    const span = Math.max(gMax - gMin, 1e-12);

    const greek = (data.greek || "delta").toLowerCase();
    // Color map: each greek gets a tailored palette
    // delta/rho: blue(low) → white → red(high)   [diverging around 0.5/0]
    // gamma/vega: black → yellow (magnitude)
    // theta: red(negative) → white → green (crosses zero)
    function colorOf(val) {
      const t = Math.max(0, Math.min(1, (val - gMin) / span));
      if (greek === "delta" || greek === "rho") {
        // diverging: blue-white-red
        if (t < 0.5) {
          const s = t * 2;
          return [Math.round(40 + 215 * s), Math.round(60 + 195 * s), Math.round(220 - 20 * s)];
        } else {
          const s = (t - 0.5) * 2;
          return [Math.round(255), Math.round(255 - 200 * s), Math.round(200 - 200 * s)];
        }
      } else if (greek === "gamma" || greek === "vega") {
        // sequential: dark-purple → bright-yellow
        return [Math.round(20 + 215 * t), Math.round(10 + 220 * t * t), Math.round(120 - 100 * t)];
      } else {
        // theta: negative is reddish, positive is greenish
        if (t < 0.5) {
          const s = (0.5 - t) * 2;
          return [Math.round(200 + 55 * s), Math.round(50 + 30 * s), Math.round(50 + 30 * s)];
        } else {
          const s = (t - 0.5) * 2;
          return [Math.round(50), Math.round(150 + 100 * s), Math.round(80)];
        }
      }
    }

    const cellW = iW / ns;
    const cellH = iH / nt;

    for (let si = 0; si < ns; si++) {
      for (let ti = 0; ti < nt; ti++) {
        const val = grid[si * nt + ti];
        if (val == null) continue;
        const x = padL + si * cellW;
        const y = padT + (nt - 1 - ti) * cellH;
        const [r, g, b] = colorOf(val);
        ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
        ctx.fillRect(x, y, Math.max(cellW - 0.5, 1), Math.max(cellH - 0.5, 1));
        if (cellW > 28 && cellH > 14) {
          ctx.fillStyle = "rgba(0,0,0,0.65)";
          ctx.font = "8px monospace";
          ctx.textAlign = "center";
          ctx.fillText(val.toFixed(3), x + cellW / 2, y + cellH / 2 + 3);
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(15,23,42,0.2)";
    ctx.lineWidth = 0.5;
    for (let si = 0; si <= ns; si++) {
      const x = padL + si * cellW;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + iH); ctx.stroke();
    }
    for (let ti = 0; ti <= nt; ti++) {
      const y = padT + ti * cellH;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iW, y); ctx.stroke();
    }

    // X axis ticks (spot)
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    const sStep = Math.max(1, Math.floor(ns / 5));
    for (let si = 0; si < ns; si += sStep) {
      const x = padL + si * cellW + cellW / 2;
      ctx.fillText(Math.round(spots[si]).toLocaleString(), x, padT + iH + 14);
    }
    ctx.fillText("Spot (S)", padL + iW / 2, h - 4);

    // Y axis ticks (maturity)
    ctx.textAlign = "right";
    const tStep = Math.max(1, Math.floor(nt / 5));
    for (let ti = 0; ti < nt; ti += tStep) {
      const y = padT + (nt - 1 - ti) * cellH + cellH / 2 + 3;
      ctx.fillText(mats[ti].toFixed(2) + "y", padL - 4, y);
    }

    // Colorbar
    const cbX = w - padR + 10;
    for (let i = 0; i <= iH; i++) {
      const t = 1 - i / iH;
      const val = gMin + t * span;
      const [r, g, b] = colorOf(val);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(cbX, padT + i, 14, 1.5);
    }
    ctx.strokeStyle = "rgba(120,120,120,0.4)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cbX, padT, 14, iH);
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "left";
    ctx.fillText(gMax.toFixed(3), cbX + 17, padT + 9);
    ctx.fillText(gMin.toFixed(3), cbX + 17, padT + iH);
    const midLbl = (gMin + (gMax - gMin) / 2).toFixed(3);
    ctx.fillText(midLbl, cbX + 17, padT + iH / 2);

    // Title
    ctx.fillStyle = "#9ca3af";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "left";
    ctx.fillText(greek.charAt(0).toUpperCase() + greek.slice(1) + " Surface", padL, padT - 6);
  });

  return `<canvas id="${id}" class="chart-canvas" style="width:100%;"></canvas>`;
}

export function thresholdCompareChart(rows, opts = {}) {
  if (!rows?.length) return "";
  const w = opts.w ?? 560;
  const h = Math.max(120, rows.length * 24 + 24);
  const pad = 18;
  const maxV = Math.max(...rows.map((r) => Math.max(Math.abs(num(r?.value)), Math.abs(num(r?.threshold)))), 1e-12);
  const bwMax = w - 2 * pad;
  const bars = rows.map((r, i) => {
    const y = pad + i * 24;
    const vW = (Math.abs(num(r?.value)) / maxV) * bwMax;
    const tW = (Math.abs(num(r?.threshold)) / maxV) * bwMax;
    return `
      <rect x="${pad}" y="${y}" width="${tW}" height="14" fill="#5f5f5f" opacity="0.45" />
      <rect x="${pad}" y="${y + 2}" width="${vW}" height="10" fill="${r?.status === "pass" ? "#a8a8a8" : "#d09a9a"}" />
    `;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">${bars}</svg>`;
}

let _barId = 0;

export function horizontalBarChart(rows, labelKey, valueKey, opts = {}) {
  if (!rows?.length) return "";
  const id = `bar-${++_barId}`;
  const padL = 110, padR = 60, padT = 12, padB = 28;
  const h = rows.length * 28 + 40;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 480;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const values = rows.map((r) => num(r[valueKey]));
    const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1e-12);
    const nGrid = 4;
    for (let i = 0; i <= nGrid; i++) {
      const x = padL + (i / nGrid) * innerW;
      ctx.strokeStyle = "rgba(120,120,120,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + innerH); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(120,120,120,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + innerH); ctx.stroke();
    rows.forEach((row, i) => {
      const v = num(row[valueKey]);
      const barH = 16;
      const slotY = padT + i * 28;
      const barY = slotY + (28 - barH) / 2;
      const bw = (Math.abs(v) / maxAbs) * innerW;
      const barX = v >= 0 ? padL : padL - bw;
      ctx.fillStyle = v >= 0 ? "#6aaa8a" : "#b06060";
      ctx.fillRect(barX, barY, bw, barH);
      const label = String(row[labelKey] || "").slice(0, 18);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(label, padL - 6, barY + barH / 2 + 3);
      const valStr = fmtTick(v);
      ctx.fillStyle = "#d1d5db";
      ctx.font = "9px monospace";
      if (v >= 0) {
        ctx.textAlign = "left";
        ctx.fillText(valStr, padL + bw + 4, barY + barH / 2 + 3);
      } else {
        ctx.textAlign = "right";
        ctx.fillText(valStr, padL - bw - 4, barY + barH / 2 + 3);
      }
    });
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(valueKey, padL + innerW / 2, h - 6);
  });
  return `<canvas id="${id}" class="chart-canvas" style="width:100%;height:${h}px;"></canvas>`;
}

let _residId = 0;

export function residualBarChart(modelPrices, residuals, opts = {}) {
  if (!modelPrices?.length) return "";
  const id = `resid-${++_residId}`;
  const padL = 40, padR = 10, padT = 16, padB = 28;
  const w = opts.w ?? 480;
  const h = opts.h ?? 140;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.offsetWidth || w;
    canvas.width = cw * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const innerW = cw - padL - padR;
    const innerH = h - padT - padB;
    const n = modelPrices.length;
    const maxP = Math.max(...modelPrices.map((v) => Math.abs(num(v))), 1e-12);
    const maxR = Math.max(...residuals.map((v) => Math.abs(num(v))), 1e-12);
    const barW = (innerW / n) * 0.4;
    const baseline = padT + innerH * 0.7;
    ctx.strokeStyle = "rgba(180,180,180,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, baseline); ctx.lineTo(padL + innerW, baseline); ctx.stroke();
    for (let i = 0; i < n; i++) {
      const p = num(modelPrices[i]);
      const ph = (Math.abs(p) / maxP) * innerH * 0.7;
      const px = padL + (i / n) * innerW + (innerW / n) * 0.05;
      ctx.fillStyle = "rgba(120,120,140,0.7)";
      ctx.fillRect(px, padT + innerH * 0.7 - ph, barW, ph);
      const r = num(residuals[i]);
      const rh = (Math.abs(r) / maxR) * innerH * 0.3;
      const rx = px + barW;
      ctx.fillStyle = r > 0 ? "rgba(220,100,80,0.8)" : "rgba(80,120,200,0.8)";
      const ry = r > 0 ? baseline - rh : baseline;
      ctx.fillRect(rx, ry, barW, rh);
      if (i % 2 === 0) {
        ctx.fillStyle = "#6b7280";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), padL + (i / n) * innerW + (innerW / n) / 2, padT + innerH + 14);
      }
    }
  });
  return `<canvas id="${id}" class="chart-canvas" style="width:100%;height:${h}px;"></canvas>`;
}

let _rankId = 0;

export function rankingBarChart(rows, labelKey, valueKey, opts = {}) {
  if (!rows?.length) return "";
  const id = `rank-${++_rankId}`;
  const padL = 110, padR = 60, padT = 12, padB = 28;
  const h = rows.length * 28 + 40;
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth || 480;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const values = rows.map((r) => Math.abs(num(r[valueKey])));
    const maxAbs = Math.max(...values, 1e-12);
    const nGrid = 4;
    for (let i = 0; i <= nGrid; i++) {
      const x = padL + (i / nGrid) * innerW;
      ctx.strokeStyle = "rgba(120,120,120,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + innerH); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(120,120,120,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + innerH); ctx.stroke();
    const n = rows.length;
    rows.forEach((row, i) => {
      const v = values[i];
      const t = n > 1 ? i / (n - 1) : 0;
      const r1 = 0x4a, g1 = 0x4a, b1 = 0x5a;
      const r2 = 0xc0, g2 = 0x60, b2 = 0x60;
      const ri = Math.round(r1 + (r2 - r1) * t);
      const gi = Math.round(g1 + (g2 - g1) * t);
      const bi = Math.round(b1 + (b2 - b1) * t);
      const barH = 16;
      const slotY = padT + i * 28;
      const barY = slotY + (28 - barH) / 2;
      const bw = (v / maxAbs) * innerW;
      ctx.fillStyle = `rgb(${ri},${gi},${bi})`;
      ctx.fillRect(padL, barY, bw, barH);
      const label = String(row[labelKey] || "").slice(0, 18);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(label, padL - 6, barY + barH / 2 + 3);
      ctx.fillStyle = "#d1d5db";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(fmtTick(v), padL + bw + 4, barY + barH / 2 + 3);
    });
    ctx.fillStyle = "#6b7280";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(valueKey, padL + innerW / 2, h - 6);
  });
  return `<canvas id="${id}" class="chart-canvas" style="width:100%;height:${h}px;"></canvas>`;
}

export function efficiencyFrontierChart(canvas, strategies, opts = {}) {
  if (!canvas || !strategies || !strategies.length) return;
  const dpr = window.devicePixelRatio || 1;
  const w = opts.w != null ? opts.w : (canvas.offsetWidth || 480);
  const h = opts.h != null ? opts.h : 220;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const padL = 64, padR = 20, padT = 28, padB = 44;
  const iW = w - padL - padR;
  const iH = h - padT - padB;

  // Extract cost (x) and risk/es95 (y); use transaction_cost as avg_cost proxy
  const points = strategies.map((s) => ({
    name: s.strategy ?? s.name ?? "?",
    x: num(s.transaction_cost ?? s.avg_cost, 0),
    y: num(s.es95 ?? s.var95, 0),
  }));

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs); const xMax = Math.max(...xs);
  const yMin = Math.min(...ys); const yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1e-12;
  const yRange = yMax - yMin || 1e-12;

  const toCanvasX = (v) => padL + ((v - xMin) / xRange) * iW;
  const toCanvasY = (v) => padT + iH - ((v - yMin) / yRange) * iH;

  // Pareto: sort by x, keep only monotonically decreasing y
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const pareto = [];
  let minY = Infinity;
  for (const p of sorted) {
    if (p.y <= minY) { pareto.push(p); minY = p.y; }
  }
  const paretoNames = new Set(pareto.map((p) => p.name));

  // Background
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (i / 4) * iH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + iW, y); ctx.stroke();
    const x = padL + (i / 4) * iW;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + iH); ctx.stroke();
  }

  // Pareto frontier dashed line
  if (pareto.length >= 2) {
    ctx.save();
    ctx.strokeStyle = "rgba(100,200,120,0.7)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    pareto.forEach((p, i) => {
      const cx = toCanvasX(p.x), cy = toCanvasY(p.y);
      if (i === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
    ctx.restore();
  }

  // Points
  const COLORS = ["#60a5fa","#f59e0b","#f87171","#a78bfa","#34d399","#fb923c"];
  points.forEach((p, i) => {
    const cx = toCanvasX(p.x), cy = toCanvasY(p.y);
    const isPareto = paretoNames.has(p.name);
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = isPareto ? COLORS[i % COLORS.length] : "rgba(120,120,140,0.6)";
    ctx.fill();
    if (isPareto) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // Label
    ctx.fillStyle = isPareto ? "#e2e8f0" : "#6b7280";
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.fillText(p.name, cx, cy - 11);
  });

  // Axes
  ctx.strokeStyle = "rgba(148,163,184,0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + iH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(padL, padT + iH); ctx.lineTo(padL + iW, padT + iH); ctx.stroke();

  // Axis labels
  ctx.fillStyle = "#6b7280";
  ctx.font = "9px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Transaction Cost →", padL + iW / 2, h - 6);
  ctx.save();
  ctx.translate(14, padT + iH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("ES95 (Risk) ↑", 0, 0);
  ctx.restore();

  // Title
  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 9px monospace";
  ctx.textAlign = "left";
  ctx.fillText("Hedge Efficiency Frontier  (lower-left = better)", padL, padT - 8);
}

// ── Payoff at expiry (SVG) ────────────────────────────────────────────────────
// points: [{x, y}] sorted by x. opts.marker: x value to mark (e.g. forward).
export function payoffChart(points, opts = {}) {
  if (!points?.length) return "";
  const w = opts.w ?? 560;
  const h = opts.h ?? 200;
  const padL = 64, padR = 16, padT = 14, padB = 30;
  const xs = points.map((p) => num(p.x));
  const ys = points.map((p) => num(p.y));
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0);
  const dx = maxX - minX || 1;
  const dy = maxY - minY || 1;
  const px = (x) => padL + ((x - minX) / dx) * (w - padL - padR);
  const py = (y) => h - padB - ((y - minY) / dy) * (h - padT - padB);
  const line = points.map((p) => `${px(num(p.x))},${py(num(p.y))}`).join(" ");
  const zeroY = py(0);
  const marker = opts.marker != null && opts.marker >= minX && opts.marker <= maxX
    ? `<line x1="${px(opts.marker)}" y1="${padT}" x2="${px(opts.marker)}" y2="${h - padB}" stroke="#6c8cff" stroke-dasharray="3,3" stroke-width="1"/>
       <text x="${px(opts.marker) + 4}" y="${padT + 10}" font-size="10" fill="#8fa0c3">F</text>`
    : "";
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" class="sparkline" preserveAspectRatio="none">
    <line x1="${padL}" y1="${zeroY}" x2="${w - padR}" y2="${zeroY}" stroke="rgba(143,160,195,0.45)" stroke-width="1"/>
    ${marker}
    <polyline points="${line}" fill="none" stroke="#31b67a" stroke-width="1.8"/>
    <text x="4" y="${py(maxY) + 4}" font-size="10" fill="#8fa0c3">${fmtTick(maxY)}</text>
    <text x="4" y="${py(minY)}" font-size="10" fill="#8fa0c3">${fmtTick(minY)}</text>
    <text x="${padL}" y="${h - 8}" font-size="10" fill="#8fa0c3">${fmtTick(minX)}</text>
    <text x="${w - padR}" y="${h - 8}" font-size="10" fill="#8fa0c3" text-anchor="end">${fmtTick(maxX)}</text>
  </svg>`;
}
