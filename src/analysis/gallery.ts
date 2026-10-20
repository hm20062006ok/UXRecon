import type { Transition } from "../types/contracts.js";

export interface GalleryItem {
  step: number;
  fromPage: string;
  toPage: string;
  action: string;
  screenshotRelPath: string;
  durationMs: number;
  result: string;
}

export function generateGalleryHtml(title: string, items: GalleryItem[], transitions: Transition[]): string {
  const cardsHtml = items
    .map(
      (item) => `
    <div class="card">
      <div class="card-header">
        <span class="badge">#${item.step}</span>
        <span class="action-tag">${item.action}</span>
        <span class="result-tag result-${item.result}">${item.result}</span>
      </div>
      <div class="img-container">
        <img src="${item.screenshotRelPath}" alt="Step ${item.step}" loading="lazy" />
      </div>
      <div class="card-footer">
        <div class="route">${item.fromPage} &rarr; ${item.toPage}</div>
        <div class="meta">${item.durationMs}ms</div>
      </div>
    </div>
  `,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - UXRecon Gallery</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --border: #334155;
    }
    body {
      margin: 0;
      padding: 24px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    header {
      margin-bottom: 32px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 16px;
    }
    h1 { margin: 0 0 8px 0; font-size: 24px; }
    .subtitle { color: var(--text-muted); font-size: 14px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .card-header {
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      border-bottom: 1px solid var(--border);
    }
    .badge { background: #334155; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
    .action-tag { background: #0284c7; color: white; padding: 2px 8px; border-radius: 4px; }
    .result-tag { margin-left: auto; padding: 2px 6px; border-radius: 4px; }
    .result-changed { background: #059669; }
    .result-no_change { background: #64748b; }
    .result-failed { background: #dc2626; }
    .result-blocked { background: #d97706; }
    .img-container {
      background: #000;
      height: 480px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .img-container img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .card-footer {
      padding: 12px 14px;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      color: var(--text-muted);
    }
    .route { font-weight: 500; color: var(--text); }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <div class="subtitle">Exploration Evidence Gallery • ${items.length} steps recorded • ${transitions.length} transitions</div>
  </header>
  <div class="grid">
    ${cardsHtml}
  </div>
</body>
</html>`;
}
