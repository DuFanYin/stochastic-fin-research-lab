/* ─── Mini sparkline (SVG) ───────────────────────────────────────────────────── */

export function sparkline(values, w = 320, h = 48) {
  if (!values || !values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = w / (values.length - 1 || 1);
  const pts = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="sparkline">
    <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="1.5" />
  </svg>`;
}

/* ─── Tiny bar chart for perf timings ───────────────────────────────────────── */

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

function num(v, fallback = 0) {
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function normalize(values) {
  const nums = values.map((v) => num(v));
  const maxAbs = Math.max(...nums.map((v) => Math.abs(v)), 1e-12);
  return { nums, maxAbs };
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

/* ─── PnL histogram (Canvas 2D) ──────────────────────────────────────────────
   Uses Canvas instead of SVG for immediate-mode drawing — GPU-composited,
   no DOM node per bar, cheap to extend to thousands of bins or animated frames.
   Pattern: inject a <canvas> placeholder, schedule draw via rAF so the element
   is guaranteed to be in the DOM before we touch the context. ─────────────── */

let _histId = 0;

export function pnlHistogramCanvas(histogram, opts = {}) {
  if (!histogram?.edges?.length || !histogram?.counts?.length) return "";
  const edges  = histogram.edges;
  const counts = histogram.counts;
  const n      = counts.length;
  const w      = opts.w ?? 560;
  const h      = opts.h ?? 160;
  const padL   = opts.padL ?? 8;
  const padR   = opts.padR ?? 8;
  const padT   = opts.padT ?? 8;
  const padB   = opts.padB ?? 20;
  const q05    = opts.q05  ?? null;
  const q50    = opts.q50  ?? null;
  const q95    = opts.q95  ?? null;

  const id = `pnl-hist-${++_histId}`;

  // Schedule draw after the canvas is in the DOM
  requestAnimationFrame(() => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const ctx    = canvas.getContext("2d");
    const dpr    = window.devicePixelRatio || 1;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const lo    = edges[0];
    const hi    = edges[n];
    const xSpan = hi - lo || 1;
    const maxC  = Math.max(...counts, 1);
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    const toX = (v) => padL + ((v - lo) / xSpan) * innerW;
    const barW = innerW / n;

    // Baseline
    ctx.strokeStyle = "rgba(120,120,120,0.35)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + innerH);
    ctx.lineTo(padL + innerW, padT + innerH);
    ctx.stroke();

    // Bars
    counts.forEach((c, i) => {
      const bh    = (c / maxC) * innerH;
      const x     = padL + i * barW;
      const y     = padT + innerH - bh;
      const edge  = edges[i];
      // colour: negative PnL red-tinted, near-zero neutral, positive green-tinted
      const mid   = (edges[i] + edges[i + 1]) / 2;
      if (mid < 0) {
        ctx.fillStyle = "rgba(200,100,100,0.65)";
      } else {
        ctx.fillStyle = "rgba(100,180,130,0.65)";
      }
      ctx.fillRect(x + 0.5, y, Math.max(barW - 1, 1), bh);
    });

    // Quantile markers
    const drawVLine = (v, color, label) => {
      if (v == null || v < lo || v > hi) return;
      const x = toX(v);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + innerH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle   = color;
      ctx.font        = `9px monospace`;
      ctx.textAlign   = "center";
      ctx.fillText(label, x, padT + innerH + 13);
      ctx.restore();
    };
    drawVLine(q05, "rgba(200,120,80,0.9)",  "q05");
    drawVLine(q50, "rgba(180,180,180,0.9)", "med");
    drawVLine(q95, "rgba(100,180,130,0.9)", "q95");

    // Zero line
    if (lo < 0 && hi > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(200,200,200,0.4)";
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(toX(0), padT);
      ctx.lineTo(toX(0), padT + innerH);
      ctx.stroke();
      ctx.restore();
    }
  });

  return `<canvas id="${id}" width="${w}" height="${h}" style="display:block;width:${w}px;height:${h}px"></canvas>`;
}

export function thresholdCompareChart(rows, opts = {}) {
  if (!rows?.length) return "";
  const w = opts.w ?? 560;
  const h = Math.max(120, rows.length * 24 + 24);
  const pad = 18;
  const maxV = Math.max(
    ...rows.map((r) => Math.max(Math.abs(num(r?.value)), Math.abs(num(r?.threshold)))),
    1e-12
  );
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
