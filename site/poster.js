/**
 * 拾闻 · 小红书图片导出
 * 纯 Canvas 2D 渲染，无第三方依赖，输出 1080×1440 (3:4) PNG
 */
window.Poster = (function () {
  "use strict";

  // ── 画布与品牌配置 ────────────────────────────
  const W = 1080;
  const H = 1440;
  const PAD = 56; // 与原型一致的左右安全边距

  // 2026.10 模板：编辑部纸张感 + 高对比黑字 + 朱橙强调
  const C = {
    bg: "#fbfaf7",
    panel: "#f4f3f0",
    panelLight: "#faf9f7",
    ink: "#0d0d0c",
    inkSoft: "#242429",
    muted: "#6e6d70",
    hair: "#c8c7c4",
    accent: "#ff4b24",
    accentDeep: "#f04420",
    accentTint: "#fff0e9",
    chipBg: "#efeeeb",
    white: "#ffffff",
  };

  const FONT = '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';
  const SERIF = '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", serif';

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

  function drawSpacedText(ctx, text, x, y, spacing) {
    let cx = x;
    Array.from(String(text || "")).forEach((char) => {
      ctx.fillText(char, cx, y);
      cx += ctx.measureText(char).width + spacing;
    });
    return cx;
  }

  function drawPanel(ctx, x, y, w, h, r = 16) {
    const gradient = ctx.createLinearGradient(x, y, x + w, y);
    gradient.addColorStop(0, "#f7f6f3");
    gradient.addColorStop(1, "#f1f0ed");
    ctx.fillStyle = gradient;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();
  }

  function drawDivider(ctx, x, y, h) {
    ctx.fillStyle = C.hair;
    ctx.fillRect(x, y, 1.5, h);
  }

  function drawNumber(ctx, number, x, y, size = 55) {
    ctx.font = `700 ${size}px ${SERIF}`;
    ctx.fillStyle = C.accent;
    ctx.textAlign = "left";
    ctx.fillText(String(number).padStart(2, "0"), x, y);
  }

  function clippedSentence(text, maxChars = 31) {
    const clean = String(text || "").trim();
    if (clean.length <= maxChars) return clean;
    const slice = clean.slice(0, maxChars);
    const cut = Math.max(slice.lastIndexOf("，"), slice.lastIndexOf("。"), slice.lastIndexOf("；"));
    return (cut >= 16 ? slice.slice(0, cut) : slice.replace(/[，。；、]$/, "")) + "…";
  }

  /** 内容页页脚：来源 + 页码 */
  function drawFooter(ctx, opts) {
    const lineY = H - 58;
    ctx.fillStyle = "#8d8c8e";
    ctx.fillRect(PAD, lineY, W - PAD * 2, 1.5);

    const y = H - 18;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = f(400, 20);
    ctx.fillStyle = C.muted;
    if (opts.left) ctx.fillText(opts.left, PAD, y);
    if (opts.right) {
      ctx.textAlign = "right";
      ctx.fillText(opts.right, W - PAD, y);
    }
    ctx.textAlign = "left";
  }

  /** 内容页顶部品牌栏 */
  function drawContentHeader(ctx, card, date) {
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = f(800, 46);
    ctx.fillStyle = C.ink;
    ctx.fillText("拾闻", PAD, 70);
    const logoW = ctx.measureText("拾闻").width;
    ctx.beginPath();
    ctx.arc(PAD + logoW + 12, 65, 5, 0, Math.PI * 2);
    ctx.fillStyle = C.accent;
    ctx.fill();

    ctx.font = f(400, 18);
    ctx.fillStyle = C.muted;
    drawSpacedText(ctx, "每天十条值得关注的新闻", PAD, 103, 6);

    const category = card.category || "综合";
    ctx.font = f(600, 22);
    const chipW = Math.max(132, ctx.measureText(category).width + 40);
    const chipX = W - PAD - chipW;
    ctx.fillStyle = C.accent;
    roundRect(ctx, chipX, 47, chipW, 50, 25);
    ctx.fill();
    ctx.fillStyle = C.white;
    ctx.textAlign = "center";
    ctx.fillText(category, chipX + chipW / 2, 80);

    ctx.textAlign = "right";
    ctx.font = f(500, 24);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(fmtDate(date), chipX - 28, 80);
    drawDivider(ctx, chipX - 16, 55, 31);

    ctx.fillStyle = "#a9a8a6";
    ctx.fillRect(PAD, 125, W - PAD * 2, 1.5);
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
      if (p.length >= 6 && means.length < 3) means.push(p.slice(0, 18));
    });
    while (means.length < 3) means.push("关注后续进展与官方口径");

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

  /** 内容卡：严格对应原型的标题、摘要条与 01/02/03 信息区 */
  function drawContentCard(news, meta) {
    const { cv, ctx } = newCanvas();
    const card = getCard(news);
    const maxW = W - PAD * 2;

    drawContentHeader(ctx, card, meta.date);

    // 主标题与解释性副标题
    const headFit = fitFont(ctx, card.headline, maxW, 1, 800, 76, 54);
    ctx.font = f(800, headFit.size);
    ctx.fillStyle = C.ink;
    ctx.fillText(headFit.lines[0], PAD, 241);

    const deck = news.reason || card.question || card.what;
    const deckFit = fitFont(ctx, deck, maxW, 1, 400, 31, 21);
    ctx.font = f(400, deckFit.size);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(deckFit.lines[0], PAD, 313);

    // 一句话总结
    drawPanel(ctx, PAD, 357, maxW, 78, 17);
    ctx.save();
    ctx.shadowColor = "rgba(255, 75, 36, 0.14)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetX = 7;
    ctx.fillStyle = C.accent;
    roundRect(ctx, PAD, 357, 230, 78, 17);
    ctx.fill();
    ctx.restore();
    ctx.font = f(700, 28);
    ctx.fillStyle = C.white;
    ctx.textAlign = "center";
    ctx.fillText("一句话总结", PAD + 115, 407);
    const oneLine = clippedSentence(card.what || news.summary, 31);
    const oneFit = fitFont(ctx, oneLine, maxW - 270, 1, 400, 28, 20);
    ctx.font = f(400, oneFit.size);
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = "left";
    ctx.fillText(oneFit.lines[0], PAD + 262, 407);

    // 01 发生了什么？
    drawPanel(ctx, PAD, 460, maxW, 220, 17);
    drawNumber(ctx, 1, PAD + 25, 528);
    drawDivider(ctx, PAD + 122, 484, 55);
    ctx.font = f(800, 38);
    ctx.fillStyle = C.ink;
    ctx.fillText("发生了什么？", PAD + 158, 526);
    ctx.font = f(400, 29);
    ctx.fillStyle = C.inkSoft;
    const whatLines = wrapText(ctx, card.what, maxW - 198);
    drawLines(ctx, whatLines, PAD + 158, 574, 43, 3);

    // 02 这意味着什么？
    drawPanel(ctx, PAD, 705, maxW, 143, 17);
    drawNumber(ctx, 2, PAD + 25, 785);
    drawDivider(ctx, PAD + 122, 729, 55);
    ctx.font = f(800, 36);
    ctx.fillStyle = C.ink;
    ctx.fillText("这意味着什么？", PAD + 158, 768);
    const question = card.question || "这件事会怎么影响你？";
    const questionFit = fitFont(ctx, question, maxW - 198, 1, 400, 28, 21);
    ctx.font = f(400, questionFit.size);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(questionFit.lines[0], PAD + 158, 816);

    // 03 这对你意味着什么
    drawPanel(ctx, PAD, 872, maxW, 351, 17);
    drawNumber(ctx, 3, PAD + 25, 951);
    drawDivider(ctx, PAD + 122, 896, 55);
    ctx.font = f(800, 36);
    ctx.fillStyle = C.ink;
    ctx.fillText(card.derived ? "为什么值得关注" : "这对你意味着什么", PAD + 158, 934);

    const means = (card.means || []).slice(0, 3);
    const itemX = PAD + 156;
    const itemW = maxW - 178;
    const itemH = 67;
    const itemGap = 14;
    const startY = means.length >= 3 ? 964 : 986;
    means.forEach((mean, i) => {
      const iy = startY + i * (itemH + itemGap);
      ctx.fillStyle = C.white;
      roundRect(ctx, itemX, iy, itemW, itemH, 26);
      ctx.fill();

      ctx.fillStyle = C.accentTint;
      roundRect(ctx, itemX + 13, iy + 9, 64, 49, 24);
      ctx.fill();
      ctx.font = `700 25px ${SERIF}`;
      ctx.fillStyle = C.accent;
      ctx.textAlign = "center";
      ctx.fillText(String(i + 1).padStart(2, "0"), itemX + 45, iy + 43);

      const meanFit = fitFont(ctx, mean, itemW - 108, 1, 400, 27, 20);
      ctx.font = f(400, meanFit.size);
      ctx.fillStyle = C.inkSoft;
      ctx.textAlign = "left";
      ctx.fillText(meanFit.lines[0], itemX + 102, iy + 43);
    });

    // 注意提示
    drawPanel(ctx, PAD, 1247, maxW, 108, 17);
    ctx.fillStyle = C.accent;
    roundRect(ctx, PAD, 1247, 196, 108, 17);
    ctx.fill();
    ctx.font = f(700, 27);
    ctx.fillStyle = C.white;
    ctx.textAlign = "center";
    ctx.fillText("注意提示：", PAD + 98, 1314);
    const note = card.note || "具体信息以官方发布及后续落地情况为准。";
    ctx.font = f(400, 23);
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = "left";
    const noteLines = wrapText(ctx, note, maxW - 236);
    const noteStartY = noteLines.length > 1 ? 1297 : 1311;
    drawLines(ctx, noteLines, PAD + 224, noteStartY, 34, 2);

    const srcName = (news.sources || []).map((s) => (typeof s === "object" ? s.name : s)).filter(Boolean)[0];
    drawFooter(ctx, {
      left: srcName ? `来源：${srcName}` : "来源：公开报道",
      right: `${String(meta.index).padStart(2, "0")}/${String(meta.total).padStart(2, "0")}`,
    });
    return cv;
  }

  /** 封面卡：大字刊头 + 日期 + 重点新闻目录 */
  function drawCoverCard(newsList, date) {
    const { cv, ctx } = newCanvas();
    const maxW = W - PAD * 2;
    const parts = String(date || "").split("-");
    const monthNames = ["JAN.", "FEB.", "MAR.", "APR.", "MAY.", "JUN.", "JUL.", "AUG.", "SEP.", "OCT.", "NOV.", "DEC."];
    const year = parts[0] || "";
    const month = Math.max(1, Math.min(12, Number(parts[1]) || 1));
    const day = parts[2] || "";

    // 刊头
    ctx.textAlign = "left";
    ctx.font = f(900, 210);
    ctx.fillStyle = C.ink;
    ctx.fillText("拾闻", PAD, 286);
    const logoW = ctx.measureText("拾闻").width;
    ctx.beginPath();
    ctx.arc(PAD + logoW + 25, 276, 23, 0, Math.PI * 2);
    ctx.fillStyle = C.accent;
    ctx.fill();

    ctx.font = f(400, 28);
    ctx.fillStyle = C.inkSoft;
    drawSpacedText(ctx, "每天十条值得关注的新闻", PAD, 361, 13);

    // 右上日期
    ctx.textAlign = "right";
    ctx.font = f(500, 31);
    ctx.fillStyle = C.ink;
    ctx.fillText(`${monthNames[month - 1]} ${year}`, W - PAD, 86);
    ctx.font = `700 132px ${SERIF}`;
    ctx.fillStyle = C.accent;
    ctx.fillText(String(month).padStart(2, "0"), W - PAD, 219);
    ctx.font = f(300, 70);
    ctx.fillStyle = C.ink;
    ctx.fillText("/", W - PAD - 18, 307);
    ctx.font = `500 40px ${SERIF}`;
    ctx.fillText(String(day).padStart(2, "0"), W - PAD, 362);

    ctx.fillStyle = C.ink;
    ctx.fillRect(PAD, 412, maxW, 1.5);

    // 主命题
    ctx.textAlign = "left";
    ctx.font = f(800, 65);
    ctx.fillStyle = C.ink;
    ctx.fillText("今日最值得关注的", PAD, 525);
    ctx.font = `700 85px ${SERIF}`;
    ctx.fillStyle = C.accent;
    const countText = String(newsList.length);
    ctx.fillText(countText, PAD, 627);
    const countW = ctx.measureText(countText).width;
    ctx.font = f(800, 65);
    ctx.fillStyle = C.ink;
    ctx.fillText("条新闻", PAD + countW + 14, 623);

    drawDivider(ctx, 742, 462, 164);
    ctx.font = f(400, 31);
    ctx.fillStyle = C.muted;
    ["从中国到世界", "在复杂的变化中", "看见更大的趋势"].forEach((line, i) => {
      ctx.fillText(line, 783, 505 + i * 49);
    });

    // 领域标签
    const categories = ["科技", "产业", "经济", "AI", "社会", "世界"];
    const chipGap = 16;
    const chipW = (maxW - chipGap * (categories.length - 1)) / categories.length;
    categories.forEach((label, i) => {
      const x = PAD + i * (chipW + chipGap);
      ctx.fillStyle = C.chipBg;
      roundRect(ctx, x, 674, chipW, 66, 33);
      ctx.fill();
      ctx.font = f(500, 28);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "center";
      ctx.fillText(label, x + chipW / 2, 716);
    });

    // 前五条重点新闻
    newsList.slice(0, 5).forEach((news, i) => {
      const y = 772 + i * 107;
      drawPanel(ctx, PAD, y, maxW, 92, 15);
      drawNumber(ctx, i + 1, PAD + 25, y + 63, 50);
      drawDivider(ctx, PAD + 114, y + 20, 54);

      const headline = getCard(news).headline || news.title || "";
      const titleFit = fitFont(ctx, headline, maxW - 220, 1, 500, 32, 23);
      ctx.font = f(500, titleFit.size);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "left";
      ctx.fillText(titleFit.lines[0], PAD + 160, y + 59);

      ctx.strokeStyle = "#78787a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(W - PAD - 49, y + 34);
      ctx.lineTo(W - PAD - 36, y + 46);
      ctx.lineTo(W - PAD - 49, y + 59);
      ctx.stroke();
    });

    // 封面页脚
    ctx.fillStyle = C.ink;
    ctx.fillRect(PAD, 1333, maxW, 1.5);
    ctx.textAlign = "left";
    ctx.font = f(400, 17);
    ctx.fillStyle = C.muted;
    ctx.fillText("SHIWEN · DAILY BRIEF", PAD, 1380);
    ctx.font = f(400, 18);
    ctx.fillText("拾起更大的视野", PAD, 1411);
    ctx.textAlign = "right";
    ctx.font = f(400, 19);
    ctx.fillText("更快   |   更深   |   更有用", W - PAD, 1394);
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

  /** 渲染一整天：封面 + N 张内容 */
  function renderDay(newsList, date) {
    const total = newsList.length;
    const out = [drawCoverCard(newsList, date)];
    newsList.forEach((n, i) => {
      out.push(drawContentCard(n, { index: i + 1, total, date }));
    });
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
    downloadOne,
    downloadDay,
    canvasToBlob,
  };
})();
