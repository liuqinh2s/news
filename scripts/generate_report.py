"""
新闻抓取 + AI 筛选脚本
1. 从 RSS 源抓取新闻
2. 从社交媒体/垂直社区抓取热搜
3. AI 大模型筛选重大新闻并生成摘要
4. 输出 Markdown 日报到 reports/ 目录
"""

import json
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

import feedparser
import httpx
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()  # 本地运行时从 .env 读取环境变量

# ── 配置 ──────────────────────────────────────────────

REPORTS_DIR = Path("reports")
REPORTS_DIR.mkdir(exist_ok=True)

ZHIPU_API_KEY = os.environ.get("ZHIPU_API_KEY", "")
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "")

BJT = timezone(timedelta(hours=8))
TODAY = datetime.now(BJT).strftime("%Y-%m-%d")

# ── RSS 源 ────────────────────────────────────────────

RSS_FEEDS = {
    # 国内
    "新华社": "http://www.xinhuanet.com/politics/news_all.htm",
    "人民网": "http://www.people.com.cn/rss/politics.xml",
    "澎湃新闻": "https://rsshub.app/thepaper/featured",
    "南方周末": "https://rsshub.app/infzm/2",
    "凤凰网": "https://rsshub.app/ifeng/news",
    "财新网": "https://rsshub.app/caixin/latest",
    "央视网": "https://rsshub.app/cctv/top",
    # 国际
    "BBC": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "Reuters": "https://rsshub.app/reuters/world",
    "NYTimes": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    "CNN": "http://rss.cnn.com/rss/edition_world.rss",
}


# ── 社交媒体 & 垂直社区热搜（通过 RSSHub 代理）──────

TRENDING_FEEDS = {
    "微博热搜": "https://rsshub.app/weibo/search/hot",
    "知乎热榜": "https://rsshub.app/zhihu/hotlist",
    "抖音热搜": "https://rsshub.app/douyin/trending",
    "B站热搜": "https://rsshub.app/bilibili/hot-search",
    "小红书热搜": "https://rsshub.app/xiaohongshu/trending",
    "Twitter趋势": "https://rsshub.app/twitter/trends",
    "YouTube趋势": "https://rsshub.app/youtube/trending",
    # 垂直社区
    "豆瓣讨论": "https://rsshub.app/douban/explore",
    "丁香园": "https://rsshub.app/dxy/news",
    "雪球热帖": "https://rsshub.app/xueqiu/hotstock/0",
    "36氪": "https://rsshub.app/36kr/newsflashes",
    "虎嗅": "https://rsshub.app/huxiu/article",
    "少数派": "https://sspai.com/feed",
    "GitHub Trending": "https://rsshub.app/github/trending/daily/any",
}


# ── 抓取函数 ──────────────────────────────────────────

def fetch_rss(name: str, url: str) -> list[dict]:
    """抓取单个 RSS 源，返回新闻列表"""
    try:
        resp = httpx.get(url, timeout=15, follow_redirects=True,
                         headers={"User-Agent": "Mozilla/5.0 NewsDigger/1.0"})
        feed = feedparser.parse(resp.text)
        items = []
        for entry in feed.entries[:20]:  # 每个源最多取 20 条
            items.append({
                "source": name,
                "title": entry.get("title", "").strip(),
                "summary": entry.get("summary", "")[:500].strip(),
                "link": entry.get("link", ""),
                "published": entry.get("published", ""),
            })
        return items
    except Exception as e:
        print(f"[WARN] RSS 抓取失败 {name}: {e}")
        return []


def fetch_with_firecrawl(url: str) -> str:
    """使用 Firecrawl API 抓取页面内容（备用方案）"""
    if not FIRECRAWL_API_KEY:
        return ""
    try:
        resp = httpx.post(
            "https://api.firecrawl.dev/v1/scrape",
            headers={"Authorization": f"Bearer {FIRECRAWL_API_KEY}"},
            json={"url": url, "formats": ["markdown"]},
            timeout=30,
        )
        data = resp.json()
        return data.get("data", {}).get("markdown", "")[:2000]
    except Exception as e:
        print(f"[WARN] Firecrawl 抓取失败 {url}: {e}")
        return ""


def collect_all_news() -> list[dict]:
    """汇总所有新闻源"""
    all_news = []

    print("📡 抓取 RSS 新闻源...")
    for name, url in RSS_FEEDS.items():
        items = fetch_rss(name, url)
        all_news.extend(items)
        print(f"  ✓ {name}: {len(items)} 条")

    print("📡 抓取社交媒体 & 垂直社区热搜...")
    for name, url in TRENDING_FEEDS.items():
        items = fetch_rss(name, url)
        all_news.extend(items)
        print(f"  ✓ {name}: {len(items)} 条")

    print(f"\n📊 共抓取 {len(all_news)} 条新闻")
    return all_news


# ── AI 筛选 ───────────────────────────────────────────

SYSTEM_PROMPT = """你是一个专业的新闻编辑，负责从海量新闻中筛选出真正具有"现象级"影响力的重大新闻。

## 评判标准
以「对人们生活核心领域的影响维度 + 影响程度」作为唯一评判标准。
影响领域包括：经济金融、科技、政治、社会、公共卫生、地缘、生态、产业。

## 入选门槛（非常严格）
- 必须是全球/国家层面的重大事件
- 必须对人们生活产生实质性、广泛性影响
- 日常新闻、娱乐八卦、普通商业动态一律不选
- 每天最多选出 0-3 条，宁缺毋滥
- 注意必须至少选出一条，没有合适的就适当放宽标准

## 输出格式
对于每条入选新闻，输出 JSON 数组，每个元素包含：
- title: 标题（8字以内，精炼概括）
- summary: 摘要（200-400字，说明事件内容及其重大影响）
- impact_areas: 影响领域数组（如 ["经济金融", "科技"]）
- impact_level: 影响等级（"现象级" 或 "重大"）
- sources: 信息来源数组

如果今天没有达到入选门槛的新闻，返回空数组 []。

请只返回 JSON，不要有其他内容。"""


def ai_filter_news(news_items: list[dict]) -> list[dict]:
    """用 AI 大模型筛选重大新闻"""
    if not ZHIPU_API_KEY:
        print("[ERROR] 未设置 ZHIPU_API_KEY，跳过 AI 筛选")
        return []

    # 构建新闻摘要文本
    news_text = ""
    for item in news_items:
        news_text += f"【{item['source']}】{item['title']}\n"
        if item['summary']:
            news_text += f"  摘要: {item['summary'][:200]}\n"
        news_text += "\n"

    # 如果内容太长，截断（GPT-4o 上下文足够大，但控制成本）
    if len(news_text) > 50000:
        news_text = news_text[:50000] + "\n...(已截断)"

    client = OpenAI(
        api_key=ZHIPU_API_KEY,
        base_url="https://open.bigmodel.cn/api/paas/v4",
    )

    print("🤖 AI 正在筛选重大新闻...")
    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"以下是今天（{TODAY}）抓取到的所有新闻，请筛选：\n\n{news_text}"},
            ],
            temperature=0.3,
            max_tokens=4000,
        )
        content = response.choices[0].message.content.strip()
        # 提取 JSON
        json_match = re.search(r'\[.*\]', content, re.DOTALL)
        if json_match:
            result = json.loads(json_match.group())
            print(f"✅ AI 筛选出 {len(result)} 条重大新闻")
            return result
        else:
            print("[WARN] AI 返回内容无法解析为 JSON")
            return []
    except Exception as e:
        print(f"[ERROR] AI 筛选失败: {e}")
        return []


# ── 生成 Markdown 日报 ───────────────────────────────

def generate_markdown(filtered_news: list[dict]) -> str:
    """生成 Markdown 格式的日报"""
    lines = [f"# {TODAY} 重大新闻", ""]

    if not filtered_news:
        lines.append("今日暂无达到入选门槛的重大新闻。")
        return "\n".join(lines)

    for i, news in enumerate(filtered_news, 1):
        title = news.get("title", "未知")
        summary = news.get("summary", "")
        areas = news.get("impact_areas", [])
        level = news.get("impact_level", "重大")
        sources = news.get("sources", [])

        lines.append(f"## {i}. {title}")
        lines.append("")
        lines.append(f"**影响领域**: {' / '.join(areas)}  ")
        lines.append(f"**影响等级**: {level}")
        lines.append("")
        lines.append(summary)
        lines.append("")
        if sources:
            lines.append(f"*来源: {', '.join(sources)}*")
            lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


# ── 主流程 ────────────────────────────────────────────

def main():
    print(f"🚀 开始生成 {TODAY} 新闻日报\n")

    # 1. 抓取所有新闻
    all_news = collect_all_news()

    if not all_news:
        print("[WARN] 未抓取到任何新闻，生成空报告")

    # 2. AI 筛选
    filtered = ai_filter_news(all_news)

    # 3. 生成 Markdown
    md_content = generate_markdown(filtered)
    report_path = REPORTS_DIR / f"{TODAY}.md"
    report_path.write_text(md_content, encoding="utf-8")
    print(f"\n📝 日报已保存: {report_path}")

    # 4. 同时保存结构化 JSON（供前端使用）
    json_path = REPORTS_DIR / f"{TODAY}.json"
    json_data = {
        "date": TODAY,
        "news": filtered,
        "total_fetched": len(all_news),
        "generated_at": datetime.now(BJT).isoformat(),
    }
    json_path.write_text(json.dumps(json_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"📦 JSON 已保存: {json_path}")


if __name__ == "__main__":
    main()
