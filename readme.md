# 重大新闻挖掘器

智能新闻筛选系统，自动从多渠道抓取新闻，通过 AI 大模型识别"现象级"重大新闻，生成每日简报并发布为静态网站。

## 在线访问

https://liuqinh2s.github.io/news/

## 工作原理

1. GitHub Actions 定时任务（北京时间每天 8:00 / 20:00）触发
2. `scripts/fetch_news.py` 从 RSS 源和社交媒体热搜抓取新闻
3. `scripts/ai_filter.py` 通过 AI 大模型筛选出真正重大的新闻，生成日报
4. 生成 Markdown 日报 + 结构化 JSON，保存到 `reports/`
5. `scripts/build.py` 将日报数据整理到 `site/data/`，生成索引
6. GitHub Pages 自动部署 `site/` 目录

## 新闻源

**RSS 新闻源：** 新华社、人民网、澎湃新闻、南方周末、凤凰网、财新网、央视网、BBC、Reuters、NYTimes、CNN

**社交媒体热搜：** 微博、知乎、抖音、B站、小红书、Twitter、YouTube

**垂直社区：** 豆瓣、丁香园、雪球、36氪、虎嗅、少数派、GitHub Trending

## 筛选标准

以「对人们生活核心领域的影响维度 + 影响程度」为唯一评判标准。覆盖经济金融、科技、政治、社会、公共卫生、地缘、生态、产业八大领域。必须是全球/国家层面的重大事件，或者是引起人们广泛讨论和传播的事件，日常新闻、娱乐八卦一律不选。

案例：

- 美以和伊朗开战
- openclaw爆火
- 张雪峰猝死

## 项目结构

```
├── .github/workflows/
│   └── daily-report.yml       # GitHub Actions 定时任务（每天两次）
├── reports/                    # 生成的日报（Markdown + JSON，按日期命名）
├── scripts/
│   ├── fetch_news.py           # 新闻抓取脚本（RSS + 社交媒体热搜）
│   ├── ai_filter.py            # AI 筛选脚本（读取原始新闻 → AI 分析 → 生成日报）
│   ├── generate_report.py      # 兼容入口（依次调用 fetch_news + ai_filter）
│   └── build.py                # 构建网站数据（生成索引、复制文件到 site/data/）
├── site/                       # 静态网站（部署到 GitHub Pages）
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── data/                   # 构建后的数据文件
│       ├── reports-index.json  # 日报索引
│       └── YYYY-MM-DD.json/md  # 每日数据
├── package.json                # Node.js 开发依赖（live-server）
├── requirements.txt            # Python 依赖
└── .env                        # 本地开发环境变量（不提交）
```

## 前端特性

- 移动端优先适配
- 近三天大新闻模块（卡片展示，点击查看详情）
- 历史归档模块（标题 ≤ 15 字 + 日期，按时间倒序）
- 亮色/暗色主题切换，自动记忆用户偏好
- 自动刷新：每 60 秒轮询检测数据更新，有新内容自动刷新页面并弹出 Toast 提示，无需手动刷新浏览器

## 本地开发

### 环境准备

```bash
# 安装 Python 依赖
pip3 install -r requirements.txt

# 配置环境变量（在 .env 文件中设置）
ZHIPU_API_KEY=你的智谱API密钥
FIRECRAWL_API_KEY=你的Firecrawl API密钥（可选，备用抓取方案）
```

### 运行

```bash
# 生成今日新闻日报（抓取 + AI 筛选一步完成）
python3 scripts/generate_report.py

# 或者分步执行：
# 1. 只抓取新闻
python3 scripts/fetch_news.py

# 2. 只运行 AI 筛选（使用已抓取的数据，适合调试 AI 或重跑）
python3 scripts/ai_filter.py

# 构建网站数据
python3 scripts/build.py
```

生成的日报在 `reports/` 目录，构建后的网站数据在 `site/data/`。

### 本地预览网站

```bash
# 安装依赖（首次）
npm install

# 启动开发服务器（自动监听文件变化，浏览器实时刷新）
npm run dev
```

也可以用 Python 简单起一个静态服务器：

```bash
python3 -m http.server 8000 -d site
```

## GitHub Secrets 配置

在仓库 Settings → Secrets and variables → Actions 中添加：

- `ZHIPU_API_KEY` — 智谱 AI API 密钥
- `FIRECRAWL_API_KEY` — Firecrawl API 密钥（可选）

## 技术栈

- Python 3.11 + feedparser + httpx + openai SDK
- 智谱 AI GLM-4-Plus（新闻筛选）
- Firecrawl（备用页面抓取）
- GitHub Actions（定时任务）
- GitHub Pages（静态网站托管）
- 原生 HTML/CSS/JS（前端，无框架依赖）
