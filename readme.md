# 重大新闻挖掘器

智能新闻筛选系统，自动从多渠道抓取新闻，通过 AI 大模型识别"现象级"重大新闻，生成每日简报并发布为静态网站。

## 在线访问

https://liuqinh2s.github.io/news/

## 工作原理

1. GitHub Actions 定时任务（每日北京时间 07:30 · 12:30 · 19:30 自动更新）触发
2. `scripts/fetch_news.py` 从 RSS 源和社交媒体热搜抓取新闻
3. `scripts/ai_filter.py` 通过 AI 大模型筛选出真正重大的新闻，生成日报
4. 同一脚本再跑一轮 AI 改写，为每条新闻生成小红书卡片文案（`card` 字段），失败时自动降级推导
5. 生成 Markdown 日报 + 结构化 JSON，保存到 `reports/`
6. `scripts/build.py` 将日报数据整理到 `site/data/`，生成索引
7. GitHub Pages 自动部署 `site/` 目录

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

**民生视角配额**：最终 10 条中要求包含 2-4 条与普通人日常生活直接相关的新闻（油价、房贷利率、社保医保、就业政策、消费品价格、交通新规等），让「这对你意味着什么」能落到具体的钱／工作／生活上，而不只是「知道了一件大事」。这类新闻只需「全国范围有效 + 对具体人群有实质影响」即可入选，但仍必须是客观事实性的政策发布、数据公布或官方通报，不收生活技巧与养生消费类内容。

## 项目结构

```
├── .github/workflows/
│   └── daily-report.yml       # GitHub Actions 定时任务（每天三次）
├── reports/                    # 生成的日报（Markdown + JSON，按日期命名）
├── scripts/
│   ├── fetch_news.py           # 新闻抓取脚本（RSS + 社交媒体热搜）
│   ├── ai_filter.py            # AI 筛选脚本（读取原始新闻 → AI 分析 → 生成日报）
│   ├── generate_report.py      # 兼容入口（依次调用 fetch_news + ai_filter）
│   └── build.py                # 构建网站数据（生成索引、复制文件到 site/data/）
├── prompts/
│   ├── filter_news.md          # 新闻筛选提示词（含民生视角配额）
│   ├── card_rewrite.md         # 小红书卡片文案改写提示词
│   └── card_rewrite_user.md    # 卡片改写的用户消息模板
├── site/                       # 静态网站（部署到 GitHub Pages）
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   ├── poster.js               # 小红书图片渲染器（Canvas 1080×1440）
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
- 一键导出小红书图片（见下）

## 小红书图片导出

网站可以直接把新闻渲染成小红书尺寸的图片，无需设计工具，也不占用仓库空间——图片在浏览器里实时生成，不入库。

**怎么用**

- 单条导出：新闻卡片底部「🖼 生成小红书图」，或归档列表里条目右侧的 🖼 图标
- 整天导出：日期分组标题右侧「🖼 整天打包」，得到 `封面 + 10 张内容 + 结尾互动卡` 共 12 张
- 预览弹窗内可左右翻页（支持 ← → 方向键、Esc 关闭），单张保存或打包成 ZIP 下载

**技术细节**

- 规格 1080×1440（3:4），小红书推荐比例；纯 Canvas 2D 绘制，无第三方依赖
- 排版做了中文优化：按「原子」断行（西文数字不拆开）、优先在标点/空格处换行避免拆词、标题自动缩字号、行首不留收尾标点、区块间距按剩余空间动态分配
- ZIP 采用 store 模式手写实现（含 CRC32），PNG 本身已压缩，无需二次压缩，因此不引入 JSZip
- 卡片信息结构：分类 → 标题 → 发生了什么 → 与读者相关的提问 → 这对你意味着什么（两条）→ 注意提示 → 来源与页码

**卡片文案字段（`card`）**

由 `prompts/card_rewrite.md` 那一轮 AI 改写生成，写入每条新闻的 `card` 字段：

| 字段 | 说明 |
| --- | --- |
| `category` | 「大类·小类」，4-6 字 |
| `headline` | 卡片标题，8-14 字，不做标题党 |
| `what` | 发生了什么，30-55 字，客观事实带数字与时间 |
| `question` | 读者第一人称提问，8-16 字 |
| `means` | 「这对你意味着什么」两条，每条 10-18 字，落到钱／工作／物价／出行 |
| `note` | 不确定性或前提提示，15-30 字 |

改写这一轮失败不会阻塞主流程：Python 侧 `_derive_card()` 与前端 `getCard()` 都会从已有的标题、摘要、入选理由降级推导，历史数据（改动之前的日报）也能正常出图。降级推导出的卡片会标记 `derived`，此时标题区改为「为什么值得关注」并省略通用提问，避免用套话冒充个人影响判断。

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
