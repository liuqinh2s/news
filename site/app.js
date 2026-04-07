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
      if (typeof s === "object" && s.url)
        return `<a href="${s.url}" target="_blank" rel="noopener">${s.name || s.url}</a>`;
      return typeof s === "string" ? s : s.name || "";
    }).join(", ");
  }

  function renderNewsCard(news, date) {
    const card = document.createElement("div");
    card.className = "news-card";
    card.addEventListener("click", () => showModal(news, date));
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
    `;
    return card;
  }

  function renderEmpty(msg) {
    return `<div class="empty-state"><p>${msg}</p></div>`;
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
    newsArr.forEach((n) => {
      const item = document.createElement("div");
      item.className = "tree-news-item";
      const isPhenomenal = n.impact_level === "现象级";
      item.innerHTML = `<span class="item-title">${n.title}</span><span class="item-level${isPhenomenal ? " phenomenal" : ""}">${n.impact_level || "重大"}</span>`;
      item.addEventListener("click", () => showModal(n, date));
      list.appendChild(item);
    });
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

  async function loadIndex() {
    // 优先使用内联数据（兼容 file://）
    if (window.__NEWS_INDEX__) return window.__NEWS_INDEX__;
    const resp = await fetch(`${DATA_BASE}/reports-index.json`);
    if (!resp.ok) return null;
    return resp.json();
  }

  async function loadDetail(date) {
    if (window.__NEWS_DATA__ && window.__NEWS_DATA__[date])
      return window.__NEWS_DATA__[date];
    try {
      const resp = await fetch(`${DATA_BASE}/${date}.json`);
      return resp.json();
    } catch {
      return null;
    }
  }

  async function loadData() {
    try {
      const index = await loadIndex();
      if (!index) {
        recentNewsEl.innerHTML = renderEmpty("暂无新闻数据，等待首次抓取...");
        return;
      }

      const recentItems = [];
      const archiveData = [];

      for (const report of index) {
        const detail = await loadDetail(report.date);
        if (!detail) continue;
        const news = detail.news || [];
        if (!news.length) continue;

        news.forEach((n) => allNewsItems.push({ news: n, date: report.date }));

        if (isWithinDays(report.date, RECENT_DAYS)) {
          news.forEach((n) => recentItems.push({ news: n, date: report.date }));
        } else {
          archiveData.push({ date: report.date, news });
        }
      }

      // 渲染近三天
      if (recentItems.length) {
        recentNewsEl.innerHTML = "";
        recentItems.forEach((item) =>
          recentNewsEl.appendChild(renderNewsCard(item.news, item.date))
        );
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
      searchResults.appendChild(renderNewsCard(item.news, item.date))
    );
  }

  // ── 自动刷新（轮询检测更新）─────────────────
  const POLL_INTERVAL = 60_000; // 60秒轮询一次
  let lastIndexHash = null;

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
        await loadData();
      }
      lastIndexHash = hash;
    } catch {
      // 静默忽略网络错误
    }
  }

  function startPolling() {
    // file:// 协议下不轮询
    if (location.protocol === "file:") return;
    // 首次记录 hash
    checkForUpdates();
    setInterval(checkForUpdates, POLL_INTERVAL);
  }

  // ── 初始化 ────────────────────────────────────
  initTheme();
  loadData().then(startPolling);
})();
