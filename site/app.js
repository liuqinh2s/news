/**
 * 重大新闻挖掘器 - 前端逻辑
 * 支持内联数据（file://兼容）和 fetch 两种加载方式
 */
(function () {
  "use strict";

  const DATA_BASE = "data";
  const RECENT_DAYS = 3;

  // ── DOM ───────────────────────────────────────
  const recentNewsEl = document.getElementById("recentNews");
  const archiveTreeEl = document.getElementById("archiveTree");
  const themeToggle = document.getElementById("themeToggle");
  const modalOverlay = document.getElementById("modalOverlay");
  const modalContent = document.getElementById("modalContent");
  const modalClose = document.getElementById("modalClose");
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".tab-panel");
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const searchMeta = document.getElementById("searchMeta");
  const toastEl = document.getElementById("toast");

  // ── 全量新闻缓存（供搜索用）────────────────
  let allNewsItems = [];

  // ── Tab 切换 ──────────────────────────────────
  const tabPanelMap = { recent: "panelRecent", archive: "panelArchive", search: "panelSearch" };
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tabPanelMap[tab.dataset.tab]).classList.add("active");
      if (tab.dataset.tab === "search") searchInput.focus();
    });
  });

  // ── 主题 ──────────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
  }

  themeToggle.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });

  // ── 工具 ──────────────────────────────────────
  function isWithinDays(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00+08:00");
    const diff = Date.now() - d.getTime();
    return diff >= 0 && diff <= days * 86400000;
  }

  // ── 渲染 ──────────────────────────────────────
  function renderSources(sources) {
    if (!sources || !sources.length) return "";
    return sources.map((s) => {
      if (typeof s === "object") {
        const name = s.name || s.url || "";
        const url = s.url || "";
        if (url) return `<a href="${url}" target="_blank" rel="noopener">${name}</a>`;
        // url 为空时，用来源名称生成搜索链接，保持可点击
        if (name) return `<a href="https://www.google.com/search?q=${encodeURIComponent(name)}" target="_blank" rel="noopener">${name}</a>`;
        return "";
      }
      return typeof s === "string" ? s : "";
    }).join(", ");
  }

  function renderNewsCard(news, date, meta) {
    const card = document.createElement("div");
    card.className = "news-card";
    const levelClass = news.impact_level === "现象级" ? "level-phenomenal" : "";
    const tags = (news.impact_areas || []).map((a) => `<span class="tag">${a}</span>`).join("");
    card.innerHTML = `
      <div class="card-header">
        <span class="card-title">${news.title}</span>
        <span class="card-date">${date}</span>
      </div>
      <p class="card-summary">${news.summary || ""}</p>
      ${news.reason ? `<p class="card-reason">🤖 AI筛选原因：${news.reason}</p>` : ""}
      <div class="card-tags">
        <span class="tag ${levelClass}">${news.impact_level || "重大"}</span>
        ${tags}
      </div>
      ${news.sources && news.sources.length ? `<div class="card-sources">来源: ${renderSources(news.sources)}</div>` : ""}
      <div class="card-actions">
        <button class="btn-poster" type="button">🖼 生成小红书图</button>
      </div>
    `;
    // 卡片主体点击看详情，导出按钮独立响应
    card.addEventListener("click", () => showModal(news, date));
    const btn = card.querySelector(".btn-poster");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPosterForNews(news, date, meta);
    });
    return card;
  }

  function renderEmpty(msg) {
    return `<div class="empty-state"><p>${msg}</p></div>`;
  }

  /** 某一天的分组标题，右侧是整天打包导出按钮 */
  function renderDayGroupHead(date, count) {
    const head = document.createElement("div");
    head.className = "day-group-head";
    head.innerHTML = `
      <span class="day-group-date">${date}</span>
      <span class="day-group-count">${count} 条</span>
      <button class="btn-poster" type="button">🖼 整天打包</button>
    `;
    head.querySelector(".btn-poster").addEventListener("click", () => openPosterForDay(date));
    return head;
  }

  // ── 弹窗 ──────────────────────────────────────
  function showModal(news, date) {
    const areas = (news.impact_areas || []).join(" / ");
    const sources = renderSources(news.sources);
    modalContent.innerHTML = `
      <h2>${news.title}</h2>
      <div class="meta">${date} · ${news.impact_level || "重大"} · ${areas}</div>
      <div class="body">
        <p>${news.summary || "暂无详细内容"}</p>
        ${news.reason ? `<p class="modal-reason">🤖 AI筛选原因：${news.reason}</p>` : ""}
        ${sources ? `<p class="modal-sources">来源: ${sources}</p>` : ""}
      </div>
    `;
    modalOverlay.classList.add("active");
  }

  modalClose.addEventListener("click", () => modalOverlay.classList.remove("active"));
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) modalOverlay.classList.remove("active");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modalOverlay.classList.remove("active");
  });

  // ── 小红书图片导出 ────────────────────────────
  // 按日期缓存当天全部新闻，用于计算页码和整天打包
  const newsByDate = {};

  const posterOverlay = document.getElementById("posterOverlay");
  const posterWrap = document.getElementById("posterCanvasWrap");
  const posterDots = document.getElementById("posterDots");
  const posterSub = document.getElementById("posterSub");
  const posterPrev = document.getElementById("posterPrev");
  const posterNext = document.getElementById("posterNext");
  const posterSaveOne = document.getElementById("posterSaveOne");
  const posterSaveAll = document.getElementById("posterSaveAll");
  const posterClose = document.getElementById("posterClose");

  // 当前预览状态
  let pState = { canvases: [], names: [], idx: 0, date: "", mode: "single" };

  function renderPosterStage() {
    posterWrap.innerHTML = "";
    const cv = pState.canvases[pState.idx];
    if (cv) posterWrap.appendChild(cv);

    posterDots.innerHTML = "";
    if (pState.canvases.length > 1) {
      pState.canvases.forEach((_, i) => {
        const dot = document.createElement("button");
        dot.className = "poster-dot" + (i === pState.idx ? " active" : "");
        dot.type = "button";
        dot.setAttribute("aria-label", `第 ${i + 1} 张`);
        dot.addEventListener("click", () => { pState.idx = i; renderPosterStage(); });
        posterDots.appendChild(dot);
      });
    }

    const multi = pState.canvases.length > 1;
    posterPrev.style.display = multi ? "" : "none";
    posterNext.style.display = multi ? "" : "none";
    posterPrev.disabled = pState.idx === 0;
    posterNext.disabled = pState.idx === pState.canvases.length - 1;
    posterSaveAll.style.display = multi ? "" : "none";
    posterSub.textContent = `${pState.date} · 第 ${pState.idx + 1}/${pState.canvases.length} 张` +
      (pState.mode === "day" ? "（含封面与结尾卡）" : "");
  }

  function openPosterModal() {
    posterOverlay.classList.add("active");
    renderPosterStage();
  }

  function closePosterModal() {
    posterOverlay.classList.remove("active");
    pState = { canvases: [], names: [], idx: 0, date: "", mode: "single" };
    posterWrap.innerHTML = "";
  }

  /** 从当天缓存里反查某条新闻的页码信息 */
  function metaOf(news, date) {
    const dayNews = newsByDate[date] || [];
    const i = dayNews.indexOf(news);
    if (i < 0) return null;
    return { index: i + 1, total: dayNews.length };
  }

  /** 单条新闻：只出一张内容图 */
  function openPosterForNews(news, date, meta) {
    if (!window.Poster) { showToast("图片模块未加载"); return; }
    const dayNews = newsByDate[date] || [news];
    const index = meta && meta.index ? meta.index : Math.max(1, dayNews.indexOf(news) + 1);
    try {
      const cv = Poster.renderCard(news, { index, total: dayNews.length, date });
      pState = {
        canvases: [cv],
        names: [`拾闻_${date}_${String(index).padStart(2, "0")}.png`],
        idx: 0, date, mode: "single",
      };
      openPosterModal();
    } catch (err) {
      console.error("生成图片失败:", err);
      showToast("生成图片失败");
    }
  }

  /** 整天：封面 + N 张内容 + 结尾卡 */
  function openPosterForDay(date) {
    if (!window.Poster) { showToast("图片模块未加载"); return; }
    const dayNews = newsByDate[date] || [];
    if (!dayNews.length) { showToast("这一天没有新闻数据"); return; }
    try {
      const canvases = Poster.renderDay(dayNews, date);
      pState = {
        canvases,
        names: canvases.map((_, i) => `拾闻_${date}_${String(i + 1).padStart(2, "0")}.png`),
        idx: 0, date, mode: "day",
      };
      openPosterModal();
    } catch (err) {
      console.error("生成图片失败:", err);
      showToast("生成图片失败");
    }
  }

  posterPrev.addEventListener("click", () => {
    if (pState.idx > 0) { pState.idx--; renderPosterStage(); }
  });
  posterNext.addEventListener("click", () => {
    if (pState.idx < pState.canvases.length - 1) { pState.idx++; renderPosterStage(); }
  });
  posterClose.addEventListener("click", closePosterModal);
  posterOverlay.addEventListener("click", (e) => {
    if (e.target === posterOverlay) closePosterModal();
  });
  document.addEventListener("keydown", (e) => {
    if (!posterOverlay.classList.contains("active")) return;
    if (e.key === "Escape") closePosterModal();
    if (e.key === "ArrowLeft") posterPrev.click();
    if (e.key === "ArrowRight") posterNext.click();
  });

  posterSaveOne.addEventListener("click", async () => {
    const cv = pState.canvases[pState.idx];
    if (!cv) return;
    posterSaveOne.disabled = true;
    try {
      const blob = await Poster.canvasToBlob(cv);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = pState.names[pState.idx];
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("图片已保存");
    } catch (err) {
      console.error(err);
      showToast("保存失败");
    } finally {
      posterSaveOne.disabled = false;
    }
  });

  posterSaveAll.addEventListener("click", async () => {
    if (pState.canvases.length < 2) return;
    posterSaveAll.disabled = true;
    const original = posterSaveAll.textContent;
    try {
      await Poster.downloadDay(newsByDate[pState.date] || [], pState.date, (done, total) => {
        posterSaveAll.textContent = `打包中 ${done}/${total}`;
      });
      showToast("已打包下载");
    } catch (err) {
      console.error(err);
      showToast("打包失败");
    } finally {
      posterSaveAll.textContent = original;
      posterSaveAll.disabled = false;
    }
  });

  // ── 归档树 ────────────────────────────────────
  function buildTree(archiveData) {
    const tree = {};
    for (const { date, news } of archiveData) {
      const [y, m, d] = date.split("-");
      if (!tree[y]) tree[y] = {};
      if (!tree[y][m]) tree[y][m] = {};
      tree[y][m][d] = { news, date };
    }
    return tree;
  }

  function makeToggle(label, count) {
    const btn = document.createElement("button");
    btn.className = "tree-toggle";
    btn.innerHTML = `<span class="arrow">▶</span><span class="node-label">${label}</span><span class="node-count">${count}条</span>`;
    return btn;
  }

  function createBranchNode(label, count, children) {
    const node = document.createElement("div");
    node.className = "tree-node";
    const toggle = makeToggle(label, count);
    toggle.addEventListener("click", () => node.classList.toggle("open"));
    node.appendChild(toggle);
    const container = document.createElement("div");
    container.className = "tree-children";
    children.forEach((c) => container.appendChild(c));
    node.appendChild(container);
    return node;
  }

  function createDayNode(label, newsArr, date) {
    const node = document.createElement("div");
    node.className = "tree-node";
    const toggle = makeToggle(label, newsArr.length);
    toggle.addEventListener("click", () => node.classList.toggle("open"));
    node.appendChild(toggle);
    const list = document.createElement("div");
    list.className = "tree-news-list";
    newsArr.forEach((n, i) => {
      const item = document.createElement("div");
      item.className = "tree-news-item";
      const isPhenomenal = n.impact_level === "现象级";
      item.innerHTML = `<span class="item-title">${n.title}</span><span class="item-level${isPhenomenal ? " phenomenal" : ""}">${n.impact_level || "重大"}</span><button class="item-poster" type="button" title="生成小红书图">🖼</button>`;
      item.addEventListener("click", () => showModal(n, date));
      item.querySelector(".item-poster").addEventListener("click", (e) => {
        e.stopPropagation();
        openPosterForNews(n, date, { index: i + 1, total: newsArr.length });
      });
      list.appendChild(item);
    });
    // 这一天整体打包
    const foot = document.createElement("div");
    foot.className = "tree-day-actions";
    foot.innerHTML = `<button class="btn-poster" type="button">🖼 整天打包（${newsArr.length + 2} 张）</button>`;
    foot.querySelector(".btn-poster").addEventListener("click", () => openPosterForDay(date));
    list.appendChild(foot);
    node.appendChild(list);
    return node;
  }

  function renderArchiveTree(archiveData) {
    if (!archiveData.length) {
      archiveTreeEl.innerHTML = renderEmpty("暂无归档新闻");
      return;
    }
    const tree = buildTree(archiveData);
    archiveTreeEl.innerHTML = "";

    Object.keys(tree).sort((a, b) => b - a).forEach((year) => {
      const months = tree[year];
      let yearCount = 0;
      const monthNodes = Object.keys(months).sort((a, b) => b - a).map((month) => {
        const days = months[month];
        let monthCount = 0;
        const dayNodes = Object.keys(days).sort((a, b) => b - a).map((day) => {
          const { news, date } = days[day];
          monthCount += news.length;
          return createDayNode(`${parseInt(day)}日`, news, date);
        });
        yearCount += monthCount;
        return createBranchNode(`${parseInt(month)}月`, monthCount, dayNodes);
      });
      archiveTreeEl.appendChild(createBranchNode(`${year}年`, yearCount, monthNodes));
    });
  }

  // ── 数据加载 ──────────────────────────────────

  async function loadIndex(bustCache) {
    // 优先使用内联数据（兼容 file://）
    if (window.__NEWS_INDEX__) return window.__NEWS_INDEX__;
    const url = bustCache
      ? `${DATA_BASE}/reports-index.json?_t=${Date.now()}`
      : `${DATA_BASE}/reports-index.json`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return resp.json();
  }

  async function loadDetail(date, bustCache) {
    if (window.__NEWS_DATA__ && window.__NEWS_DATA__[date])
      return window.__NEWS_DATA__[date];
    try {
      const url = bustCache
        ? `${DATA_BASE}/${date}.json?_t=${Date.now()}`
        : `${DATA_BASE}/${date}.json`;
      const resp = await fetch(url);
      return resp.json();
    } catch {
      return null;
    }
  }

  async function loadData(bustCache) {
    try {
      const index = await loadIndex(bustCache);
      if (!index) {
        recentNewsEl.innerHTML = renderEmpty("暂无新闻数据，等待首次抓取...");
        return;
      }

      const recentDays = [];
      const archiveData = [];

      for (const report of index) {
        const detail = await loadDetail(report.date, bustCache);
        if (!detail) continue;
        const news = detail.news || [];
        if (!news.length) continue;

        // 缓存当天全量新闻，导出图片时用来算页码和整天打包
        newsByDate[report.date] = news;
        news.forEach((n) => allNewsItems.push({ news: n, date: report.date }));

        if (isWithinDays(report.date, RECENT_DAYS)) {
          recentDays.push({ date: report.date, news });
        } else {
          archiveData.push({ date: report.date, news });
        }
      }

      // 渲染近三天：按天分组，每组带整天导出入口
      if (recentDays.length) {
        recentNewsEl.innerHTML = "";
        recentDays.forEach(({ date, news }) => {
          recentNewsEl.appendChild(renderDayGroupHead(date, news.length));
          news.forEach((n, i) =>
            recentNewsEl.appendChild(
              renderNewsCard(n, date, { index: i + 1, total: news.length })
            )
          );
        });
      } else {
        recentNewsEl.innerHTML = renderEmpty("近三天暂无新入选的大新闻");
      }

      // 渲染归档树
      renderArchiveTree(archiveData);
    } catch (err) {
      console.error("加载数据失败:", err);
      recentNewsEl.innerHTML = renderEmpty("数据加载失败，请稍后刷新");
    }
  }

  // ── 搜索 ──────────────────────────────────────
  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(doSearch, 250);
  });

  function doSearch() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      searchResults.innerHTML = renderEmpty("输入关键词搜索所有新闻");
      searchMeta.textContent = "";
      return;
    }
    const keywords = q.split(/\s+/);
    const matched = allNewsItems.filter(({ news }) => {
      const haystack = [
        news.title,
        news.summary,
        news.reason,
        ...(news.impact_areas || []),
        news.impact_level || "",
      ].join(" ").toLowerCase();
      return keywords.every((kw) => haystack.includes(kw));
    });
    searchMeta.textContent = `找到 ${matched.length} 条结果`;
    if (!matched.length) {
      searchResults.innerHTML = renderEmpty("没有找到相关新闻");
      return;
    }
    searchResults.innerHTML = "";
    matched.forEach((item) =>
      searchResults.appendChild(renderNewsCard(item.news, item.date, metaOf(item.news, item.date)))
    );
  }

  // ── Toast 提示 ─────────────────────────────────
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    setTimeout(() => toastEl.classList.add("hidden"), 2000);
  }

  // ── 自动刷新（轮询检测更新）─────────────────
  const POLL_INTERVAL = 60_000; // 60秒轮询一次
  let lastIndexHash = null;
  let autoRefreshTimer = null;

  function hashString(str) {
    // 简单哈希，用于比较内容是否变化
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return h;
  }

  async function checkForUpdates() {
    try {
      const resp = await fetch(`${DATA_BASE}/reports-index.json?_t=${Date.now()}`);
      if (!resp.ok) return;
      const text = await resp.text();
      const hash = hashString(text);
      if (lastIndexHash !== null && hash !== lastIndexHash) {
        console.log("[auto-refresh] 检测到数据更新，刷新中...");
        allNewsItems = [];
        Object.keys(newsByDate).forEach((k) => delete newsByDate[k]);
        await loadData(true);
        showToast("数据已自动更新");
      }
      lastIndexHash = hash;
    } catch {
      // 静默忽略网络错误
    }
  }

  function startAutoRefresh() {
    // file:// 协议下不轮询
    if (location.protocol === "file:") return;
    if (autoRefreshTimer) return;
    // 首次记录 hash
    checkForUpdates();
    autoRefreshTimer = setInterval(checkForUpdates, POLL_INTERVAL);
  }

  // ── 初始化 ────────────────────────────────────
  initTheme();
  loadData(true).then(startAutoRefresh);
})();
