/**
 * 重大新闻挖掘器 - 前端逻辑
 * 从 site/data/ 读取静态 JSON 数据并渲染
 */

(function () {
  "use strict";

  // ── 配置 ──────────────────────────────────────
  const DATA_BASE = "data";
  const RECENT_DAYS = 3;

  // ── DOM ───────────────────────────────────────
  const recentNewsEl = document.getElementById("recentNews");
  const archiveNewsEl = document.getElementById("archiveNews");
  const themeToggle = document.getElementById("themeToggle");
  const modalOverlay = document.getElementById("modalOverlay");
  const modalContent = document.getElementById("modalContent");
  const modalClose = document.getElementById("modalClose");

  // ── 主题切换 ──────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", saved);
  }

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });

  // ── 工具函数 ──────────────────────────────────
  function isWithinDays(dateStr, days) {
    const date = new Date(dateStr + "T00:00:00+08:00");
    const now = new Date();
    const diff = now - date;
    return diff >= 0 && diff <= days * 24 * 60 * 60 * 1000;
  }

  function formatDate(dateStr) {
    const parts = dateStr.split("-");
    return `${parts[0]}.${parts[1]}`;
  }


  // ── 渲染函数 ──────────────────────────────────

  function renderSources(sources) {
    if (!sources || sources.length === 0) return "";
    return sources.map(s => {
      if (typeof s === "object" && s.url) {
        return `<a href="${s.url}" target="_blank" rel="noopener">${s.name || s.url}</a>`;
      }
      return typeof s === "string" ? s : (s.name || "");
    }).join(", ");
  }

  function renderNewsCard(news, date) {
    const card = document.createElement("div");
    card.className = "news-card";
    card.addEventListener("click", () => showModal(news, date));

    const levelClass = news.impact_level === "现象级" ? "level-phenomenal" : "";
    const tags = (news.impact_areas || [])
      .map((a) => `<span class="tag">${a}</span>`)
      .join("");

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

  function renderArchiveItem(title, date) {
    const item = document.createElement("div");
    item.className = "archive-item";
    item.innerHTML = `
      <span class="archive-title">${title}</span>
      <span class="archive-date">(${formatDate(date)})</span>
    `;
    return item;
  }

  function renderEmpty(message) {
    return `<div class="empty-state"><p>${message}</p></div>`;
  }

  // ── 弹窗 ──────────────────────────────────────

  function showModal(news, date) {
    const areas = (news.impact_areas || []).join(" / ");
    const sources = renderSources(news.sources);
    modalContent.innerHTML = `
      <h2>${news.title}</h2>
      <div class="meta">
        ${date} · ${news.impact_level || "重大"} · ${areas}
      </div>
      <div class="body">
        <p>${news.summary || "暂无详细内容"}</p>
        ${news.reason ? `<p class="modal-reason">🤖 AI筛选原因：${news.reason}</p>` : ""}
        ${sources ? `<p class="modal-sources">来源: ${sources}</p>` : ""}
      </div>
      </div>
    `;
    modalOverlay.classList.add("active");
  }

  modalClose.addEventListener("click", () => {
    modalOverlay.classList.remove("active");
  });

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove("active");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      modalOverlay.classList.remove("active");
    }
  });


  // ── 数据加载 ──────────────────────────────────

  async function loadData() {
    try {
      const resp = await fetch(`${DATA_BASE}/reports-index.json`);
      if (!resp.ok) {
        recentNewsEl.innerHTML = renderEmpty("暂无新闻数据，等待首次抓取...");
        return;
      }
      const index = await resp.json();

      const recentItems = [];
      const archiveItems = [];

      for (const report of index) {
        // 加载每日详情
        let detail;
        try {
          const detailResp = await fetch(`${DATA_BASE}/${report.date}.json`);
          detail = await detailResp.json();
        } catch {
          continue;
        }

        const news = detail.news || [];
        if (news.length === 0) continue;

        if (isWithinDays(report.date, RECENT_DAYS)) {
          // 近三天：完整卡片
          for (const n of news) {
            recentItems.push({ news: n, date: report.date });
          }
        } else {
          // 历史：归档条目
          for (const n of news) {
            archiveItems.push({ title: n.title, date: report.date });
          }
        }
      }

      // 渲染近三天
      if (recentItems.length > 0) {
        recentNewsEl.innerHTML = "";
        for (const item of recentItems) {
          recentNewsEl.appendChild(renderNewsCard(item.news, item.date));
        }
      } else {
        recentNewsEl.innerHTML = renderEmpty("近三天暂无新入选的大新闻");
      }

      // 渲染归档
      if (archiveItems.length > 0) {
        archiveNewsEl.innerHTML = "";
        for (const item of archiveItems) {
          archiveNewsEl.appendChild(renderArchiveItem(item.title, item.date));
        }
      } else {
        archiveNewsEl.innerHTML = renderEmpty("暂无归档新闻");
      }
    } catch (err) {
      console.error("加载数据失败:", err);
      recentNewsEl.innerHTML = renderEmpty("数据加载失败，请稍后刷新");
    }
  }

  // ── 初始化 ────────────────────────────────────
  initTheme();
  loadData();
})();
