/** 拾闻 · X 图片简报：独立排版，10 条新闻均分为 3+3+2+2，最多四张。 */
window.XPoster = (function () {
  "use strict";
  const W = 1200, H = 1600, PAD = 64, MAX_NEWS = 12;
  const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  const C = { bg: "#faf9f7", ink: "#1a1a1a", body: "#42413e", muted: "#78736b", accent: "#9a6a24", line: "#e2ded6" };
  const font = (weight, size) => `${weight} ${size}px ${FONT}`;

  // 不裁掉新闻条目；非十条日报也均匀分组，不生成空白页。
  function groupNews(newsList) {
    if (!Array.isArray(newsList) || !newsList.length) throw new Error("这一天没有新闻数据");
    if (newsList.length > MAX_NEWS) throw new Error("X 四图版最多支持 12 条新闻，当前日报请使用小红书整天打包");
    const count = Math.min(4, newsList.length);
    const size = Math.floor(newsList.length / count), extra = newsList.length % count;
    let offset = 0;
    return Array.from({ length: count }, (_, i) => {
      const items = newsList.slice(offset, offset + size + (i < extra ? 1 : 0));
      const page = { items, start: offset + 1 };
      offset += items.length;
      return page;
    });
  }

  // 按字符测量，确保长英文、数字与历史字段也不会越界。
  function wrap(ctx, text, width) {
    const lines = [];
    for (const paragraph of String(text || "").split("\n")) {
      let line = "";
      for (const char of Array.from(paragraph.trim())) {
        if (line && ctx.measureText(line + char).width > width) {
          if (/^[，。、；：！？）】》”%]$/.test(char) && Array.from(line).length > 1) {
            const chars = Array.from(line);
            const last = chars.pop();
            lines.push(chars.join("").trimEnd());
            line = last + char;
          } else { lines.push(line.trimEnd()); line = char.trimStart(); }
        } else { line += char; }
      }
      if (line.trim()) lines.push(line.trim());
    }
    return lines.length ? lines : [""];
  }

  function fit(ctx, text, width, maxLines, weight, size, minSize) {
    let lines;
    while (true) {
      ctx.font = font(weight, size);
      lines = wrap(ctx, text, width);
      if (lines.length <= maxLines || size <= minSize) break;
      size -= 2;
    }
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      let last = Array.from(lines[maxLines - 1]);
      while (last.length && ctx.measureText(last.join("") + "…").width > width) last.pop();
      lines[maxLines - 1] = last.join("").replace(/[，。、；：]$/, "") + "…";
    }
    return { lines, size, weight };
  }

  function paint(ctx, block, x, y, lineHeight, color) {
    ctx.font = font(block.weight, block.size);
    ctx.fillStyle = color;
    block.lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  }

  function renderPage(page, date, pageIndex, pageCount, total) {
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.accent; ctx.fillRect(0, 0, W, 7);
    ctx.font = font(800, 52); ctx.fillStyle = C.ink;
    ctx.fillText("拾闻", PAD, 90);
    ctx.font = font(400, 28); ctx.fillStyle = C.muted; ctx.textAlign = "right";
    ctx.fillText(String(date).replace(/-/g, "."), W - PAD, 84);
    ctx.textAlign = "left"; ctx.font = font(700, 58); ctx.fillStyle = C.ink;
    ctx.fillText(`今日 ${total} 条新闻`, PAD, 172);
    ctx.font = font(400, 27); ctx.fillStyle = C.accent;
    ctx.fillText(`第 ${String(page.start).padStart(2, "0")}—${String(page.start + page.items.length - 1).padStart(2, "0")} 条`, PAD, 222);
    ctx.textAlign = "right"; ctx.fillText(`${pageIndex + 1} / ${pageCount}`, W - PAD, 222); ctx.textAlign = "left";

    const top = 255, bottom = 1504, gap = 20;
    const rowH = (bottom - top - gap * (page.items.length - 1)) / page.items.length;
    const x = PAD + 76, width = W - PAD - x;
    page.items.forEach((news, i) => {
      const y = top + i * (rowH + gap);
      const card = window.Poster.getCard(news);
      ctx.fillStyle = C.line; ctx.fillRect(PAD, y, W - PAD * 2, 1.5);
      ctx.font = font(600, 32); ctx.fillStyle = C.accent;
      ctx.fillText(String(page.start + i).padStart(2, "0"), PAD, y + 60);
      const roomy = page.items.length < 3;
      const title = fit(ctx, card.headline || news.title, width, 2, 700, roomy ? 60 : 52, 44);
      const titleLH = title.size * 1.2;
      paint(ctx, title, x, y + 60, titleLH, C.ink);
      const bodyY = y + 60 + (title.lines.length - 1) * titleLH + 56;
      const note = card.note ? fit(ctx, card.note, width, 2, 400, 26, 24) : null;
      const noteH = note ? note.lines.length * 34 + 14 : 0;
      const sourceY = y + rowH - 14;
      const bodyBottom = sourceY - 38 - noteH;
      const bodySize = roomy ? 42 : 36;
      const bodyLH = roomy ? 58 : 48;
      const bodyLines = Math.max(1, Math.floor((bodyBottom - bodyY) / bodyLH) + 1);
      const body = fit(ctx, card.what || news.summary || "暂无摘要", width, bodyLines, 400, bodySize, roomy ? 36 : 32);
      paint(ctx, body, x, bodyY, bodyLH, C.body);
      if (note) paint(ctx, note, x, sourceY - 38 - (note.lines.length - 1) * 34, 34, C.muted);
      const source = (news.sources || []).map(s => typeof s === "string" ? s : s && s.name).find(Boolean) || "公开报道";
      const src = fit(ctx, `来源：${source}`, width - 280, 1, 400, 24, 24);
      paint(ctx, src, x, sourceY, 30, C.muted);
      const category = fit(ctx, card.category || "综合", 250, 1, 500, 24, 24);
      ctx.textAlign = "right"; paint(ctx, category, W - PAD, sourceY, 30, C.accent); ctx.textAlign = "left";
    });
    ctx.fillStyle = C.line; ctx.fillRect(PAD, 1533, W - PAD * 2, 1);
    ctx.font = font(400, 24); ctx.fillStyle = C.muted;
    ctx.fillText("拾闻 · 每天十条值得关注的新闻", PAD, 1574);
    ctx.textAlign = "right"; ctx.fillText("liuqinh2s.github.io/news", W - PAD, 1574);
    return cv;
  }

  function renderDay(newsList, date) {
    const pages = groupNews(newsList);
    return pages.map((page, i) => renderPage(page, date, i, pages.length, newsList.length));
  }
  function filename(date, index) { return `拾闻_${date}_X_${String(index + 1).padStart(2, "0")}.png`; }
  async function downloadPages(canvases, date, onProgress) {
    if (!canvases.length || canvases.length > 4) throw new Error("X 图片数量应为 1—4 张");
    const files = [];
    for (let i = 0; i < canvases.length; i++) {
      const blob = await window.Poster.canvasToBlob(canvases[i]);
      if (!blob || blob.size > 5 * 1024 * 1024) throw new Error("图片生成失败或超过 5MB，请重试");
      files.push({ name: filename(date, i), data: new Uint8Array(await blob.arrayBuffer()) });
      if (onProgress) onProgress(i + 1, canvases.length);
    }
    window.Poster.saveBlob(window.Poster.makeZip(files), `拾闻_${date}_X图片.zip`);
  }
  return { W, H, groupNews, renderDay, filename, downloadPages };
})();
