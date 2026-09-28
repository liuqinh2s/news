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

  // 拾闻自有风格：奶油白纸底 + 墨绿字 + 橙色点缀
  const C = {
    bg: "#f4f0e6",
    bgTint: "#ebe9dc",
    ink: "#183f35",
    inkSoft: "#344f45",
    muted: "#727d6d",
    hair: "#d4d7c7",
    accent: "#d85b32",
    accentDeep: "#b34425",
    accentTint: "#f5e2d6",
    chipBg: "#ebe9dc",
    seal: "#b34425",
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

  // 日历封面、详情卡、尾卡共用的纸张与品牌排版。
  function paperText(ctx, value, x, y, size, color = C.ink, weight = 400, align = "left") {
    ctx.font = f(weight, size);
    ctx.textBaseline = "top"; ctx.textAlign = align; ctx.fillStyle = color;
    ctx.fillText(String(value), x, y);
  }

  function paperRule(ctx, y, color = C.ink) {
    ctx.fillStyle = color; ctx.fillRect(66, y, W - 132, 2);
  }

  function drawPaperHeader(ctx, subtitle = "SHIWEN / DAILY DIGEST") {
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, W, 20);
    [92, 988].forEach(x => {
      ctx.fillStyle = C.hair; ctx.beginPath(); ctx.arc(x, 53, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x, 51, 9, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = C.hair; ctx.lineWidth = 1; ctx.setLineDash([7, 11]);
    ctx.beginPath(); ctx.moveTo(52, 89); ctx.lineTo(1028, 89); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.ink; roundRect(ctx, 66, 131, 46, 54, 4); ctx.fill();
    ctx.fillStyle = C.bg; ctx.fillRect(75, 141, 27, 4); ctx.fillRect(75, 153, 14, 20);
    [154, 162, 170].forEach(y => ctx.fillRect(94, y, 10, 2));
    paperText(ctx, "拾闻", 129, 122, 64, C.ink, 900);
    paperText(ctx, "每日新闻日历", 1014, 135, 25, C.ink, 700, "right");
    ctx.font = "400 13px Arial, Helvetica, sans-serif";
    ctx.fillStyle = C.inkSoft; ctx.textAlign = "right"; ctx.fillText(subtitle, 1014, 176);
    paperRule(ctx, 222);
  }

  /** 保证长英文和超长历史文案也不出界；裁剪时明确显示省略号。 */
  function paperLines(ctx, value, width, maxLines) {
    const raw = wrapText(ctx, value, width).flatMap(line => {
      if (ctx.measureText(line).width <= width) return [line];
      const out = []; let part = "";
      for (const ch of Array.from(line)) {
        if (part && ctx.measureText(part + ch).width > width) { out.push(part); part = ""; }
        part += ch;
      }
      if (part) out.push(part);
      return out;
    });
    const lines = raw.slice(0, maxLines);
    if (raw.length > maxLines) {
      let tail = lines[maxLines - 1].replace(/[，。、；：\s]+$/, "");
      while (tail && ctx.measureText(tail + "…").width > width) tail = Array.from(tail).slice(0, -1).join("");
      lines[maxLines - 1] = tail + "…";
    }
    return lines;
  }

  function paperParagraph(ctx, lines, x, y, leading, size, color = C.ink, weight = 400) {
    lines.forEach((line, i) => paperText(ctx, line, x, y + i * leading, size, color, weight));
    return y + lines.length * leading;
  }

  function drawPaperFooter(ctx, left, right) {
    paperRule(ctx, 1316);
    ctx.font = f(400, 23);
    const source = paperLines(ctx, left, 520, 1)[0] || "";
    paperText(ctx, source, 66, 1340, 23, C.inkSoft);
    paperText(ctx, right, 1014, 1340, 22, C.inkSoft, 400, "right");
    paperText(ctx, "信息过载的时代，少即是多", 66, 1383, 17, C.muted);
  }

  /** 详情卡：报纸式标题、事实摘要、读者提问、墨绿影响面板。 */
  function drawContentCard(news, meta) {
    const { cv, ctx } = newCanvas();
    const card = getCard(news);
    const width = W - 132;
    drawPaperHeader(ctx);
    const index = String(meta.index).padStart(2, "0");
    paperText(ctx, index, 66, 249, 38, C.accent, 900);
    ctx.font = f(900, 38);
    const categoryX = 66 + ctx.measureText(index).width + 24;
    ctx.font = f(700, 25);
    const category = paperLines(ctx, card.category || "综合", 700 - categoryX, 1)[0];
    paperText(ctx, category, categoryX, 259, 25, C.ink, 700);
    if (news.impact_level === "现象级") {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
      roundRect(ctx, 870, 249, 144, 48, 6); ctx.stroke();
      paperText(ctx, "现象级", 942, 258, 24, C.accentDeep, 700, "center");
    } else {
      paperText(ctx, fmtDate(meta.date), 1014, 261, 23, C.muted, 400, "right");
    }

    // 先测量整页，再仅在必要时统一收紧字号；常规正文为 36px。
    const means = Array.isArray(card.means) ? card.means.slice(0, 2) : [];
    let layout;
    for (const scale of [1, 0.96, 0.92, 0.88, 0.84]) {
      const bodySize = Math.round(36 * scale);
      const questionSize = Math.round(34 * scale), meanSize = Math.round(34 * scale);
      const headline = card.headline || news.title || "";
      const headFit = fitFont(ctx, headline, width, 2, 900, Math.round(76 * scale), Math.round(60 * scale));
      const headSize = headFit.size;
      const head = headFit.lines.length <= 2 && headFit.lines.every(line => ctx.measureText(line).width <= width)
        ? headFit.lines : paperLines(ctx, headline, width, 2);
      ctx.font = f(400, bodySize);
      const what = paperLines(ctx, card.what || news.summary || "", width, 4);
      ctx.font = f(700, questionSize);
      const question = card.question && !card.derived ? paperLines(ctx, card.question, width - 72, 2) : [];
      ctx.font = f(400, meanSize);
      const impacts = means.map(m => paperLines(ctx, m, width - 150, 2));
      const headLine = headSize * 1.25, bodyLine = bodySize * 1.46;
      const questionLine = questionSize * 1.4, meanLine = meanSize * 1.42;
      const headH = head.length * headLine;
      const whatH = 44 + what.length * bodyLine;
      const questionH = question.length ? 36 + question.length * questionLine : 0;
      const impactH = impacts.length ? 112 + impacts.reduce((sum, lines) => sum + lines.length * meanLine, 0) + (impacts.length - 1) * 20 : 0;
      const gaps = 1 + (questionH ? 1 : 0) + (impactH ? 1 : 0);
      const blocksH = headH + whatH + questionH + impactH;
      layout = { headSize, bodySize, questionSize, meanSize, head, what, question, impacts, headLine, bodyLine, questionLine, meanLine, headH, whatH, questionH, impactH, gaps, blocksH };
      if (blocksH + gaps * 22 <= 850) break;
    }
    const l = layout;
    const gap = Math.min(44, Math.max(22, (850 - l.blocksH) / l.gaps));
    let y = 324;
    y = paperParagraph(ctx, l.head, 66, y, l.headLine, l.headSize, C.ink, 900) + gap;
    paperText(ctx, "发生了什么", 66, y, 25, C.accentDeep, 700);
    y += 44;
    y = paperParagraph(ctx, l.what, 66, y, l.bodyLine, l.bodySize, C.inkSoft);
    if (l.questionH) {
      y += gap;
      ctx.fillStyle = C.accentTint; roundRect(ctx, 66, y, width, l.questionH, 8); ctx.fill();
      ctx.fillStyle = C.accent; ctx.fillRect(66, y + 15, 5, l.questionH - 30);
      paperParagraph(ctx, l.question, 99, y + 18, l.questionLine, l.questionSize, C.ink, 700);
      y += l.questionH;
    }
    if (l.impactH) {
      y += gap;
      ctx.fillStyle = C.ink; roundRect(ctx, 66, y, width, l.impactH, 12); ctx.fill();
      paperText(ctx, card.derived ? "为什么值得关注" : "这对你意味着什么", 96, y + 28, 30, C.bg, 700);
      let iy = y + 82;
      l.impacts.forEach((lines, i) => {
        ctx.fillStyle = C.accent; roundRect(ctx, 96, iy + 3, 40, 40, 5); ctx.fill();
        paperText(ctx, String(i + 1).padStart(2, "0"), 116, iy + 7, 24, C.bg, 700, "center");
        iy = paperParagraph(ctx, lines, 166, iy, l.meanLine, l.meanSize, C.bg) + 20;
      });
    }

    if (card.note) {
      paperText(ctx, "注意提示", 66, 1210, 24, C.accentDeep, 700);
      ctx.font = f(400, 24);
      paperParagraph(ctx, paperLines(ctx, card.note, width - 126, 3), 192, 1210, 31, 24, C.muted);
    }
    const source = (news.sources || []).map(s => typeof s === "object" ? s.name : s).filter(Boolean)[0];
    drawPaperFooter(ctx, source ? `来源：${source}` : "来源：公开报道", `${meta.index}/${meta.total} · ${fmtDate(meta.date)}`);
    return cv;
  }

  /** 日报日期按日历日解析，不受浏览器时区和夏令时影响。 */
  function coverCalendar(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ""));
    if (!match) throw new Error("日报日期应为 YYYY-MM-DD");
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const value = new Date(0);
    value.setUTCFullYear(year, month - 1, day);
    value.setUTCHours(0, 0, 0, 0);
    if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
      throw new Error("日报日期无效");
    }
    const dayMs = 86400000;
    const weekday = (value.getUTCDay() + 6) % 7;
    const jan = new Date(value);
    jan.setUTCMonth(0, 1);
    const ordinal = Math.round((value - jan) / dayMs) + 1;
    const seed = Math.round((value - Date.UTC(2026, 8, 28)) / dayMs);
    const mod = (n, m) => ((n % m) + m) % m;
    return {
      year, month, day, weekday, ordinal,
      layout: mod(seed, 3), motif: mod(seed, 4),
      week: Array.from({ length: 7 }, (_, i) => new Date(value.getTime() + (i - weekday) * dayMs)),
    };
  }

  /** 全部装饰以路径绘制；四种主题按日期轮换，不请求图片或模型。 */
  function drawCalendarMotif(ctx, kind, x, y, radius) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(radius / 100, radius / 100);
    ctx.fillStyle = C.accent;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    const stroke = (points) => {
      ctx.beginPath();
      points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
      ctx.stroke();
    };
    const disc = (cx, cy, r) => {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    };
    if (kind === 0) {
      // 日出：剪裁后的条纹不会伸出太阳轮廓。
      for (let a = 0; a < 12; a++) {
        const angle = a * Math.PI / 6;
        stroke([[111 * Math.cos(angle), 111 * Math.sin(angle)], [128 * Math.cos(angle), 128 * Math.sin(angle)]]);
      }
      disc(0, 0, 87);
      ctx.save();
      ctx.beginPath(); ctx.arc(0, 0, 87, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = C.bg; ctx.lineWidth = 4;
      for (let yy = 15; yy < 87; yy += 13) stroke([[-90, yy], [90, yy]]);
      ctx.restore();
    } else if (kind === 1) {
      // 山峦：纸色、浅沙色与沙棕构成三层剪影。
      ctx.fillStyle = C.accentTint; disc(0, 0, 112);
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, 112, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = C.accent; disc(42, -46, 29);
      ctx.fillStyle = C.hair;
      ctx.beginPath(); ctx.moveTo(-140, 85); ctx.lineTo(-42, -45); ctx.lineTo(72, 85); ctx.fill();
      ctx.fillStyle = C.accentDeep;
      ctx.beginPath(); ctx.moveTo(-50, 115); ctx.lineTo(39, -6); ctx.lineTo(142, 115); ctx.fill();
      ctx.strokeStyle = C.bg; ctx.lineWidth = 3;
      for (let yy = 65; yy < 115; yy += 15) stroke([[-125, yy], [125, yy]]);
      ctx.restore();
    } else if (kind === 2) {
      // 星轨：椭圆轨道与卫星，采用同一品牌色。
      ctx.fillStyle = C.accentTint; disc(0, 0, 104);
      for (const angle of [-0.65, 0.65]) {
        ctx.beginPath(); ctx.ellipse(0, 0, 123, 51, angle, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = C.accentDeep; disc(0, 0, 28);
      ctx.fillStyle = C.accent; disc(93, -65, 11); disc(-87, -67, 7);
    } else {
      // 城市：窗格、屋顶和天际线均为几何形状。
      ctx.fillStyle = C.accentTint; disc(0, 0, 112);
      ctx.fillStyle = C.accent; disc(62, -61, 29);
      const blocks = [[-88, -13, 40, 100], [-37, -78, 47, 165], [21, 7, 32, 80], [64, -24, 28, 111]];
      blocks.forEach(([bx, by, bw, bh], i) => {
        ctx.fillStyle = i % 2 ? C.accentDeep : C.accent;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = C.bg;
        for (let wy = by + 12; wy < 70; wy += 21) {
          for (let wx = bx + 9; wx < bx + bw - 6; wx += 15) ctx.fillRect(wx, wy, 5, 8);
        }
      });
      stroke([[-112, 88], [112, 88]]);
    }
    ctx.restore();
  }

  /** 封面：纯代码日历，采用用户确认的奶油白、墨绿和橙色。 */
  function drawCoverCard(newsList, date) {
    const { cv, ctx } = newCanvas();
    const cal = coverCalendar(date);
    const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
    const months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
    const monthNames = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    const englishWeek = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    const left = 66, right = W - left;
    const text = (str, x, y, size, color = C.ink, weight = 400, align = "left", latin = false) => {
      ctx.font = latin ? `${weight} ${size}px Arial, Helvetica, sans-serif` : f(weight, size);
      ctx.textAlign = align; ctx.textBaseline = "top"; ctx.fillStyle = color;
      ctx.fillText(String(str), x, y);
    };
    const rule = (y) => { ctx.fillStyle = C.ink; ctx.fillRect(left, y, right - left, 2); };
    const dateNumber = (x, y, width, height) => {
      const str = String(cal.day).padStart(2, "0");
      let size = 500;
      ctx.font = `900 ${size}px Arial, Helvetica, sans-serif`;
      ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
      let m = ctx.measureText(str);
      const visibleWidth = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      const visibleHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      size *= Math.min(width / visibleWidth, height / visibleHeight);
      ctx.font = `900 ${size}px Arial, Helvetica, sans-serif`;
      m = ctx.measureText(str);
      const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
      ctx.fillStyle = C.ink;
      ctx.fillText(str, x + (width - w) / 2 + m.actualBoundingBoxLeft, y + m.actualBoundingBoxAscent);
    };

    drawPaperHeader(ctx);
    text(`${cal.year}  /  ${months[cal.month - 1]}`, left, 250, 25, C.ink, 700, "left", true);
    // 表示年内第几日，避免把它误标成尚未统计过的期数。
    text(`DAY ${String(cal.ordinal).padStart(3, "0")}`, right, 252, 19, C.muted, 400, "right", true);

    // 相邻日期轮换构图；2026-09-28 对应已确认的左日期、右太阳样稿。
    if (cal.layout === 0) {
      dateNumber(66, 337, 624, 360);
      drawCalendarMotif(ctx, cal.motif, 865, 409, 100);
      text(String(cal.month).padStart(2, "0"), 865, 574, 90, C.accent, 700, "center", true);
      text(`星期${weekdays[cal.weekday]}`, 865, 690, 35, C.ink, 700, "center");
      text(monthNames[cal.month - 1], left, 744, 30, C.ink, 700);
      text(englishWeek[cal.weekday], 200, 754, 16, C.muted, 400, "left", true);
    } else if (cal.layout === 1) {
      drawCalendarMotif(ctx, cal.motif, 205, 417, 103);
      text(String(cal.month).padStart(2, "0"), 205, 580, 90, C.accent, 700, "center", true);
      text(`星期${weekdays[cal.weekday]}`, 205, 695, 35, C.ink, 700, "center");
      dateNumber(393, 337, 621, 360);
      text(monthNames[cal.month - 1], right, 744, 30, C.ink, 700, "right");
      text(englishWeek[cal.weekday], 393, 754, 16, C.muted, 400, "left", true);
    } else {
      ctx.fillStyle = C.accentTint; roundRect(ctx, left, 308, right - left, 65, 10); ctx.fill();
      text(`${monthNames[cal.month - 1]} / ${String(cal.month).padStart(2, "0")}`, 88, 326, 26, C.accentDeep, 700);
      text(`星期${weekdays[cal.weekday]}`, right - 22, 326, 26, C.accentDeep, 700, "right");
      dateNumber(260, 410, 560, 310);
      drawCalendarMotif(ctx, cal.motif, 143, 562, 56);
      drawCalendarMotif(ctx, (cal.motif + 2) % 4, 937, 562, 56);
      text(englishWeek[cal.weekday], W / 2, 753, 18, C.muted, 400, "center", true);
    }
    rule(798);

    // 周历从周一开始，跨月/跨年直接计算；高亮日报当天而非系统今天。
    cal.week.forEach((value, i) => {
      const x = left + i * 136;
      const active = i === cal.weekday;
      if (active) { ctx.fillStyle = C.accent; roundRect(ctx, x, 827, 130, 137, 10); ctx.fill(); }
      const color = active ? C.bg : i >= 5 ? C.accent : C.ink;
      text(weekdays[i], x + 65, 845, 22, color, 400, "center");
      text(value.getUTCDate(), x + 65, 890, 35, color, 700, "center", true);
      if (value.getUTCDate() === 1) text(`${value.getUTCMonth() + 1}月`, x + 65, 940, 14, color, 400, "center");
    });

    text("今天", left, 1007, 48, C.ink, 700);
    text(newsList.length, 181, 992, 72, C.accent, 700, "left", true);
    const countWidth = ctx.measureText(String(newsList.length)).width;
    text("条", 181 + countWidth + 14, 1007, 48, C.ink, 700);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(963, 1051, 42, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(943, 1051); ctx.lineTo(983, 1051);
    ctx.moveTo(970, 1038); ctx.lineTo(983, 1051); ctx.lineTo(970, 1064); ctx.stroke();
    // 适配各平台中文字体的实际宽度，不横向压扁标题。
    let headlineSize = 91;
    ctx.font = f(900, headlineSize);
    while (ctx.measureText("值得你知道的大事").width > right - left && headlineSize > 60) {
      ctx.font = f(900, --headlineSize);
    }
    text("值得你知道的大事", left, 1116, headlineSize, C.ink, 900);
    rule(1259);
    text("从 20+ 信息源筛选", left, 1290, 26, C.ink, 700);
    text("信息过载的时代，少即是多", left, 1344, 21, C.muted);
    ctx.strokeStyle = C.accent; ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let j = 0; j < 180; j++) {
        const y = 1324 + k * 14 + 8 * Math.sin(j / 26 + cal.motif * 0.4);
        if (j === 0) ctx.moveTo(834, y); else ctx.lineTo(834 + j, y);
      }
      ctx.stroke();
    }
    return cv;
  }

  /** 尾卡：延续同一纸张、墨绿标题和橙色装饰。 */
  function drawClosingCard(newsList, date) {
    const { cv, ctx } = newCanvas();
    drawPaperHeader(ctx);
    paperText(ctx, fmtDate(date), 66, 255, 25, C.ink, 700);
    paperText(ctx, `${newsList.length} 条新闻`, 1014, 255, 25, C.accentDeep, 700, "right");
    // 对话符号全部由路径绘制。
    ctx.strokeStyle = C.accent; ctx.lineWidth = 5;
    roundRect(ctx, 467, 381, 146, 104, 25); ctx.stroke();
    ctx.fillStyle = C.bg; ctx.fillRect(490, 480, 40, 10);
    ctx.beginPath(); ctx.moveTo(491, 480); ctx.lineTo(491, 506); ctx.lineTo(528, 485); ctx.stroke();
    [510, 540, 570].forEach(x => { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(x, 431, 5, 0, Math.PI * 2); ctx.fill(); });
    paperText(ctx, "今天哪条", W / 2, 565, 82, C.ink, 900, "center");
    paperText(ctx, "和你最有关？", W / 2, 670, 82, C.ink, 900, "center");
    paperText(ctx, "评论区说说你的答案。", W / 2, 826, 36, C.inkSoft, 400, "center");
    paperText(ctx, "想看哪条单独深讲，也可以留言。", W / 2, 884, 32, C.inkSoft, 400, "center");
    ctx.fillStyle = C.accent; ctx.fillRect(496, 981, 88, 5);
    paperText(ctx, `每天 ${newsList.length} 条大新闻 · 拾闻`, W / 2, 1044, 30, C.ink, 700, "center");
    ctx.font = f(400, 24);
    const disclaimer = "信息整理自公开权威来源，具体以官方发布及当地执行政策为准。";
    paperParagraph(ctx, paperLines(ctx, disclaimer, W - 132, 3), 66, 1210, 33, 24, C.muted);
    drawPaperFooter(ctx, fmtDate(date), `${newsList.length + 2}/${newsList.length + 2}`);
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
    makeZip, saveBlob, // 供其他平台复用导出工具，不复用小红书排版
  };
})();


