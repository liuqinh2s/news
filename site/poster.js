/**
 * 拾闻 · 小红书图片导出
 * 纯 Canvas 2D 渲染，无第三方依赖，输出 1080×1440 (3:4) PNG
 */
window.Poster = (function () {
  "use strict";

  // ── 画布与品牌配置 ────────────────────────────
  const W = 1080;
  const H = 1440;
  const PAD = 84; // 左右安全边距

  // 拾闻自有风格：暖纸底 + 墨黑字 + 沙棕点缀
  const C = {
    bg: "#faf9f7",
    bgTint: "#f3f0ea",
    ink: "#1a1a1a",
    inkSoft: "#4a4a4a",
    muted: "#8c8880",
    hair: "#e2ded6",
    accent: "#c08a3e",
    accentDeep: "#9a6a24",
    accentTint: "#f7efe1",
    chipBg: "#efece5",
    seal: "#b4463c",
  };

  const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif';

  const f = (weight, size) => `${weight} ${size}px ${FONT}`;

  // ── 文本排版工具 ──────────────────────────────

  /** 按最大宽度折行，支持中英混排（中文逐字断行，英文按词断行） */
  function wrapText(ctx, text, maxWidth) {
    const out = [];
    const paragraphs = String(text || "").split("\n");

    for (const para of paragraphs) {
      if (!para) { out.push(""); continue; }
      // 切成「原子」：连续的西文/数字算一个词，中文每字一个
      const atoms = para.match(/[A-Za-z0-9%$.,:+\-—/]+|[^\s]|\s+/g) || [];
      let line = "";

      for (const atom of atoms) {
        // 行首不留空白，行尾空白不参与测宽
        if (/^\s+$/.test(atom)) {
          if (line) line += " ";
          continue;
        }
        const test = line + atom;
        if (ctx.measureText(test).width > maxWidth && line) {
          // 避免行首出现收尾标点
          if (/^[，。、；：！？）】》”』%]/.test(atom) && line.length > 1) {
            out.push(line.slice(0, -1).trimEnd());
            line = line.slice(-1) + atom;
          } else {
            out.push(line.trimEnd());
            line = atom;
          }
        } else {
          line = test;
        }
      }
      out.push(line.trimEnd());
    }
    return out.filter((l, i) => l !== "" || i === 0);
  }

  /** 逐行绘制，返回结束时的 y 坐标 */
  function drawLines(ctx, lines, x, y, lineHeight, maxLines) {
    const list = maxLines ? lines.slice(0, maxLines) : lines;
    list.forEach((line, i) => {
      let text = line;
      // 超出行数时最后一行加省略号
      if (maxLines && lines.length > maxLines && i === list.length - 1) {
        text = line.replace(/[，。、；：]$/, "") + "…";
      }
      ctx.fillText(text, x, y + i * lineHeight);
    });
    return y + list.length * lineHeight;
  }

  /** 两行标题的断行优化：优先在自然断点换行，其次避免末行孤字 */
  function balanceTwoLines(ctx, text, maxWidth) {
    const greedy = wrapText(ctx, text, maxWidth);
    if (greedy.length !== 2) return greedy;

    const chars = Array.from(text);
    const tailPunct = /^[，。、；：！？）】》”』%]/;

    // 优先在空格或标点之后断行，避免把「加拿大」这类词从中间劈开
    const naturals = [];
    for (let i = 1; i < chars.length; i++) {
      if (!/[\s，。、；：！？）】》]/.test(chars[i - 1])) continue;
      if (/\s/.test(chars[i]) || tailPunct.test(chars[i])) continue;
      naturals.push(i);
    }
    const center = chars.length / 2;
    naturals.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
    for (const cut of naturals) {
      const a = chars.slice(0, cut).join("").trim();
      const b = chars.slice(cut).join("").trim();
      if (!a || !b) continue;
      if (ctx.measureText(a).width <= maxWidth && ctx.measureText(b).width <= maxWidth) {
        return [a, b];
      }
    }

    // 没有可用的自然断点时，只在末行明显过短（孤字）时才强行均衡
    if (ctx.measureText(greedy[1]).width >= ctx.measureText(greedy[0]).width * 0.34) return greedy;

    // 从中点向两侧找一个断点，使两行都不超宽且尽量均衡
    const mid = Math.ceil(chars.length / 2);
    for (let delta = 0; delta <= 4; delta++) {
      for (const cut of [mid + delta, mid - delta]) {
        if (cut <= 0 || cut >= chars.length) continue;
        // 不要把收尾标点留到行首
        if (tailPunct.test(chars[cut])) continue;
        const a = chars.slice(0, cut).join("").trim();
        const b = chars.slice(cut).join("").trim();
        if (!a || !b) continue;
        if (ctx.measureText(a).width <= maxWidth && ctx.measureText(b).width <= maxWidth) {
          return [a, b];
        }
      }
    }
    return greedy;
  }

  /** 自动缩字号：在 maxLines 行内放得下为止 */
  function fitFont(ctx, text, maxWidth, maxLines, weight, startSize, minSize) {
    let size = startSize;
    while (size > minSize) {
      ctx.font = f(weight, size);
      if (wrapText(ctx, text, maxWidth).length <= maxLines) break;
      size -= 2;
    }
    ctx.font = f(weight, size);
    const lines = maxLines === 2 ? balanceTwoLines(ctx, text, maxWidth) : wrapText(ctx, text, maxWidth);
    return { size, lines };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 页脚：来源 + 页码，所有卡片统一 */
  function drawFooter(ctx, opts) {
    const y = H - 74;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = f(400, 25);
    ctx.fillStyle = C.muted;
    if (opts.left) ctx.fillText(opts.left, PAD, y);
    if (opts.right) {
      ctx.textAlign = "right";
      ctx.fillText(opts.right, W - PAD, y);
    }
    ctx.textAlign = "left";
  }

  /** 品牌标识：右上角 */
  function drawBrand(ctx) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = f(700, 30);
    ctx.fillStyle = C.accentDeep;
    ctx.fillText("拾闻", W - PAD, 92);
    ctx.font = f(400, 20);
    ctx.fillStyle = C.muted;
    ctx.fillText("每天十条大新闻", W - PAD, 128);
    ctx.textAlign = "left";
  }
  // ── 卡片绘制 ──────────────────────────────────

  function newCanvas() {
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    return { cv, ctx };
  }

  function fmtDate(dateStr) {
    return String(dateStr || "").replace(/-/g, ".");
  }

  /** 从 news 对象取卡片文案，没有 card 字段时前端兜底推导 */
  function getCard(news) {
    if (news.card && news.card.headline && news.card.what) return news.card;

    const areas = news.impact_areas || [];
    const summary = news.summary || "";
    const sentences = summary.split(/(?<=[。！？])/).filter(Boolean);
    let what = "";
    for (const s of sentences) {
      if (what.length + s.length > 60 && what) break;
      what += s;
      if (what.length >= 30) break;
    }
    what = what || summary;
    // 与 Python 侧 _derive_card 保持一致：单句超长时按标点截断
    if (what.length > 60) {
      const cut = Math.max(what.lastIndexOf("，", 60), what.lastIndexOf("、", 60));
      what = cut >= 30 ? what.slice(0, cut) + "…" : what.slice(0, 58) + "…";
    }
    const means = [];
    (news.reason || "").split(/[，,。；;]/).forEach((p) => {
      p = p.trim();
      if (p.length >= 6 && means.length < 2) means.push(p.slice(0, 18));
    });
    while (means.length < 2) means.push("关注后续进展与官方口径");

    return {
      category: areas.slice(0, 2).join("·") || "综合",
      headline: (news.title || "").slice(0, 14),
      what: what,
      question: "这件事会怎么影响你？",
      means,
      note: "信息整理自公开报道，具体以官方发布为准。",
      // 兜底推导的文案质量弱于 AI 改写，标记出来供渲染层区分
      derived: true,
    };
  }

  /** 内容卡：分类 → 标题 → 发生了什么 → 提问 → 意味着什么 → 提示 → 页脚 */
  function drawContentCard(news, meta) {
    const { cv, ctx } = newCanvas();
    const card = getCard(news);
    const maxW = W - PAD * 2;
    let y = 96;

    // 顶部装饰细线
    ctx.fillStyle = C.accent;
    ctx.fillRect(0, 0, W, 8);

    // 分类 chip
    ctx.font = f(600, 26);
    const chipText = card.category || "综合";
    const chipW = ctx.measureText(chipText).width + 44;
    ctx.fillStyle = C.chipBg;
    roundRect(ctx, PAD, y - 4, chipW, 52, 26);
    ctx.fill();
    ctx.fillStyle = C.accentDeep;
    ctx.textBaseline = "middle";
    ctx.fillText(chipText, PAD + 22, y + 23);

    // 影响等级（现象级才标）：紧跟分类右侧，避免与右上角品牌标识重叠
    if (news.impact_level === "现象级") {
      const badgeX = PAD + chipW + 16;
      ctx.font = f(600, 24);
      const badgeW = ctx.measureText("现象级").width + 32;
      ctx.fillStyle = "#f6e4e2";
      roundRect(ctx, badgeX, y - 4, badgeW, 52, 26);
      ctx.fill();
      ctx.fillStyle = C.seal;
      ctx.fillText("现象级", badgeX + 16, y + 23);
    }
    ctx.textBaseline = "alphabetic";
    y += 100;

    // ── 先测量各区块高度，再把剩余空间均摊到区块间距 ──
    const headFit = fitFont(ctx, card.headline, maxW, 2, 700, 76, 52);
    const headH = headFit.lines.length * headFit.size * 1.32;

    ctx.font = f(400, 33);
    const whatLines = wrapText(ctx, card.what, maxW).slice(0, 3);
    const whatH = 46 + whatLines.length * 52;

    // 兜底推导时的提问是通用套话，直接省略，把版面留给正文
    const qFit = card.question && !card.derived
      ? fitFont(ctx, card.question, maxW - 76, 2, 700, 36, 28)
      : null;
    const qH = qFit ? 40 + qFit.lines.length * (qFit.size * 1.4) : 0;

    ctx.font = f(400, 33);
    const wrapped = (card.means || []).slice(0, 2).map((m) => wrapText(ctx, m, maxW - 130).slice(0, 2));
    const itemsH = wrapped.reduce((s, w) => s + w.length * 50 + 30, 0);
    const boxH = 84 + 30 + itemsH;

    const noteY = H - 188;
    const blocksH = headH + whatH + qH + boxH;
    // 4 段间距：标题→发生了什么→提问→影响框→注意提示
    const gapCount = qFit ? 4 : 3;
    const slack = noteY - 46 - y - blocksH;
    const gap = Math.min(88, Math.max(34, slack / gapCount));
    // 间距封顶后仍有余量时，整组下移一半，让版面上下平衡而不是底部空一块
    const leftover = slack - gap * gapCount;
    if (leftover > 0) y += leftover / 2;

    // 主标题
    ctx.font = f(700, headFit.size);
    ctx.fillStyle = C.ink;
    y = drawLines(ctx, headFit.lines, PAD, y + headFit.size * 0.5, headFit.size * 1.32, 2);
    y += gap;

    // 发生了什么
    ctx.font = f(700, 27);
    ctx.fillStyle = C.accentDeep;
    ctx.fillText("发生了什么", PAD, y);
    y += 46;
    ctx.font = f(400, 33);
    ctx.fillStyle = C.inkSoft;
    y = drawLines(ctx, whatLines, PAD, y, 52, 3);
    y += gap;

    // 一句提问
    if (qFit) {
      ctx.fillStyle = C.accentTint;
      roundRect(ctx, PAD, y, maxW, qH, 20);
      ctx.fill();
      ctx.fillStyle = C.accentDeep;
      ctx.font = f(700, qFit.size);
      drawLines(ctx, qFit.lines, PAD + 38, y + 26 + qFit.size * 0.8, qFit.size * 1.4, 2);
      y += qH + gap;
    }

    // 这对你意味着什么
    ctx.fillStyle = C.bgTint;
    roundRect(ctx, PAD, y, maxW, boxH, 24);
    ctx.fill();

    let my = y + 56;
    ctx.font = f(700, 34);
    ctx.fillStyle = C.ink;
    // 兜底推导时内容其实是「为何重要」，不宜标成「对你意味着什么」
    ctx.fillText(card.derived ? "为什么值得关注" : "这对你意味着什么", PAD + 38, my);
    my += 24;
    ctx.fillStyle = C.hair;
    ctx.fillRect(PAD + 38, my, maxW - 76, 2);
    my += 48;

    wrapped.forEach((lines, i) => {
      // 序号圆点
      ctx.beginPath();
      ctx.arc(PAD + 56, my - 11, 19, 0, Math.PI * 2);
      ctx.fillStyle = C.accent;
      ctx.fill();
      ctx.font = f(700, 24);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1), PAD + 56, my - 3);
      ctx.textAlign = "left";

      ctx.font = f(400, 33);
      ctx.fillStyle = C.inkSoft;
      my = drawLines(ctx, lines, PAD + 96, my, 50, 2) + 30;
    });

    // 注意提示（固定位置，紧邻页脚上方）
    if (card.note) {
      ctx.font = f(700, 25);
      ctx.fillStyle = C.seal;
      ctx.fillText("注意提示", PAD, noteY);
      ctx.font = f(400, 25);
      ctx.fillStyle = C.muted;
      const noteX = PAD + ctx.measureText("注意提示").width + 46;
      drawLines(ctx, wrapText(ctx, card.note, W - PAD - noteX), noteX, noteY, 38, 2);
    }

    // 页脚
    const srcName = (news.sources || []).map((s) => (typeof s === "object" ? s.name : s)).filter(Boolean)[0];
    drawFooter(ctx, {
      left: srcName ? `来源：${srcName}` : "来源：公开报道",
      right: `${meta.index}/${meta.total} · ${fmtDate(meta.date)}`,
    });
    drawBrand(ctx);
    return cv;
  }

  /** 封面卡：大数字 + 主标题 + 日期 */
  function drawCoverCard(newsList, date) {
    const { cv, ctx } = newCanvas();
    const maxW = W - PAD * 2;

    ctx.fillStyle = C.accent;
    ctx.fillRect(0, 0, W, 8);

    // 大数字
    ctx.textAlign = "center";
    ctx.font = f(800, 300);
    ctx.fillStyle = C.accent;
    ctx.fillText(String(newsList.length), W / 2, 520);

    // 主标题
    ctx.font = f(800, 82);
    ctx.fillStyle = C.ink;
    const title = `今天${newsList.length}条，值得你知道的大事`;
    const lines = wrapText(ctx, title, maxW);
    let y = 660;
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, y + i * 108));
    y += Math.min(lines.length, 2) * 108;

    // 分隔线
    ctx.fillStyle = C.seal;
    ctx.fillRect(W / 2 - 44, y + 6, 88, 6);

    // 日期与副标题
    ctx.font = f(400, 36);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(`${fmtDate(date)} ｜ AI 从 20+ 信息源筛选`, W / 2, y + 92);

    // 标题清单预览
    ctx.font = f(400, 27);
    ctx.fillStyle = C.muted;
    ctx.textAlign = "left";
    let ly = y + 176;
    newsList.slice(0, 5).forEach((n, i) => {
      const t = `${i + 1}  ${(getCard(n).headline || n.title || "").slice(0, 18)}`;
      ctx.fillText(t, PAD + 20, ly);
      ly += 46;
    });
    if (newsList.length > 5) {
      ctx.fillStyle = C.accentDeep;
      ctx.fillText(`…… 还有 ${newsList.length - 5} 条，右滑查看`, PAD + 20, ly + 6);
    }

    drawFooter(ctx, { left: "拾闻 · 信息过载的时代，少即是多", right: `1/${newsList.length + 2}` });
    drawBrand(ctx);
    return cv;
  }

  /** 尾卡：互动引导 */
  function drawClosingCard(newsList, date) {
    const { cv, ctx } = newCanvas();
    const maxW = W - PAD * 2;

    ctx.fillStyle = C.accent;
    ctx.fillRect(0, 0, W, 8);

    ctx.textAlign = "center";
    ctx.font = f(800, 76);
    ctx.fillStyle = C.ink;
    const q = "今天哪条和你最有关？";
    wrapText(ctx, q, maxW).slice(0, 2).forEach((l, i) => ctx.fillText(l, W / 2, 620 + i * 100));

    ctx.font = f(400, 38);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText("评论区说说你的答案。", W / 2, 760);
    ctx.fillText("想看哪条单独深讲，也可以留言。", W / 2, 822);

    ctx.fillStyle = C.seal;
    ctx.fillRect(W / 2 - 44, 886, 88, 6);

    ctx.font = f(400, 30);
    ctx.fillStyle = C.muted;
    ctx.fillText("每天 10 条大新闻 · 拾闻", W / 2, 964);

    ctx.font = f(400, 24);
    const disclaimer = "信息整理自公开权威来源，具体以官方发布及当地执行政策为准。";
    ctx.fillStyle = C.muted;
    wrapText(ctx, disclaimer, maxW - 100).forEach((l, i) =>
      ctx.fillText(l, W / 2, 1240 + i * 36)
    );

    ctx.textAlign = "left";
    drawFooter(ctx, { left: `${fmtDate(date)}`, right: `${newsList.length + 2}/${newsList.length + 2}` });
    drawBrand(ctx);
    return cv;
  }
  // ── ZIP 打包（store 模式，无压缩，零依赖）────

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** 用 store 模式打一个 zip（PNG 本身已压缩，不再二次压缩） */
  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    const u16 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
    const u32 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
    const push = (arr, list) => { list.push(arr); return arr.length; };

    for (const file of files) {
      const nameBytes = enc.encode(file.name);
      const data = file.data;
      const crc = crc32(data);
      let local = 0;
      local += push(u32(0x04034b50), chunks);
      local += push(u16(20), chunks);          // version
      local += push(u16(0x0800), chunks);      // UTF-8 flag
      local += push(u16(0), chunks);           // store
      local += push(u16(0), chunks);           // time
      local += push(u16(0), chunks);           // date
      local += push(u32(crc), chunks);
      local += push(u32(data.length), chunks);
      local += push(u32(data.length), chunks);
      local += push(u16(nameBytes.length), chunks);
      local += push(u16(0), chunks);
      local += push(nameBytes, chunks);
      local += push(data, chunks);

      const c = [];
      push(u32(0x02014b50), c);
      push(u16(20), c); push(u16(20), c);
      push(u16(0x0800), c); push(u16(0), c);
      push(u16(0), c); push(u16(0), c);
      push(u32(crc), c);
      push(u32(data.length), c); push(u32(data.length), c);
      push(u16(nameBytes.length), c);
      push(u16(0), c); push(u16(0), c);
      push(u16(0), c); push(u16(0), c);
      push(u32(0), c);
      push(u32(offset), c);
      push(nameBytes, c);
      central.push(c);
      offset += local;
    }

    const centralFlat = central.flat();
    const centralSize = centralFlat.reduce((s, a) => s + a.length, 0);
    const end = [
      u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(centralSize), u32(offset), u16(0),
    ];
    return new Blob([...chunks, ...centralFlat, ...end], { type: "application/zip" });
  }

  // ── 对外接口 ──────────────────────────────────

  function canvasToBlob(cv) {
    return new Promise((resolve) => cv.toBlob(resolve, "image/png"));
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** 渲染单条新闻为 canvas */
  function renderCard(news, meta) {
    return drawContentCard(news, meta);
  }

  /** 渲染一整天：封面 + N 张内容 + 尾卡 */
  function renderDay(newsList, date) {
    const total = newsList.length;
    const out = [drawCoverCard(newsList, date)];
    newsList.forEach((n, i) => {
      out.push(drawContentCard(n, { index: i + 1, total, date }));
    });
    out.push(drawClosingCard(newsList, date));
    return out;
  }

  /** 导出单张图片 */
  async function downloadOne(news, meta) {
    const cv = drawContentCard(news, meta);
    const blob = await canvasToBlob(cv);
    saveBlob(blob, `拾闻_${meta.date}_${String(meta.index).padStart(2, "0")}.png`);
  }

  /** 导出一整天为 zip */
  async function downloadDay(newsList, date, onProgress) {
    const canvases = renderDay(newsList, date);
    const files = [];
    for (let i = 0; i < canvases.length; i++) {
      const blob = await canvasToBlob(canvases[i]);
      const buf = new Uint8Array(await blob.arrayBuffer());
      files.push({ name: `拾闻_${date}_${String(i + 1).padStart(2, "0")}.png`, data: buf });
      if (onProgress) onProgress(i + 1, canvases.length);
    }
    saveBlob(makeZip(files), `拾闻_${date}_小红书图片.zip`);
  }

  return {
    W, H, COLORS: C,
    getCard,
    renderCard,
    renderDay,
    drawCoverCard,
    drawClosingCard,
    downloadOne,
    downloadDay,
    canvasToBlob,
  };
})();
