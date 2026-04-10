from __future__ import annotations

"""
新闻抓取脚本
从 RSS 源和社交媒体/垂直社区抓取新闻，保存原始数据到 reports/ 目录。

用法：
    python scripts/fetch_news.py
"""

import asyncio
import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

import feedparser
import httpx
from dotenv import load_dotenv

load_dotenv()

# ── 配置 ──────────────────────────────────────────────

REPORTS_DIR = Path("reports")
REPORTS_DIR.mkdir(exist_ok=True)

LOGS_DIR = Path("logs")
LOGS_DIR.mkdir(exist_ok=True)

CONFIG_DIR = Path("config")

FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "")

BJT = timezone(timedelta(hours=8))
TODAY = datetime.now(BJT).strftime("%Y-%m-%d")

# ── 日志配置 ──────────────────────────────────────────

logger = logging.getLogger("fetch_news")
logger.setLevel(logging.DEBUG)

_log_formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

_file_handler = logging.FileHandler(LOGS_DIR / f"{TODAY}.log", encoding="utf-8")
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(_log_formatter)
logger.addHandler(_file_handler)

_console_handler = logging.StreamHandler()
_console_handler.setLevel(logging.INFO)
_console_handler.setFormatter(_log_formatter)
logger.addHandler(_console_handler)

# ── 加载新闻源配置 ───────────────────────────────────


def load_feeds():
    """从 config/feeds.json 加载新闻源配置"""
    feeds_path = CONFIG_DIR / "feeds.json"
    if not feeds_path.exists():
        raise FileNotFoundError(f"新闻源配置文件不存在: {feeds_path}")
    data = json.loads(feeds_path.read_text(encoding="utf-8"))
    return data.get("rss_feeds", {}), data.get("trending_feeds", {})


RSS_FEEDS, TRENDING_FEEDS = load_feeds()

# ── 抓取函数 ──────────────────────────────────────────

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
REQUEST_TIMEOUT = 10


def _is_today(published_str: str) -> bool:
    """判断 RSS 条目的发布时间是否为今天（北京时间）"""
    if not published_str:
        return True

    from email.utils import parsedate_to_datetime

    try:
        dt = parsedate_to_datetime(published_str)
        dt_bjt = dt.astimezone(BJT)
        return dt_bjt.strftime("%Y-%m-%d") == TODAY
    except Exception:
        pass

    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S%z",
                "%Y-%m-%d %H:%M:%S", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(published_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=BJT)
            dt_bjt = dt.astimezone(BJT)
            return dt_bjt.strftime("%Y-%m-%d") == TODAY
        except ValueError:
            continue

    if TODAY in published_str:
        return True

    return True


def _parse_rss_response(name: str, text: str) -> list[dict]:
    """解析 RSS 响应文本，返回新闻列表（只保留今天的新闻）"""
    feed = feedparser.parse(text)
    items = []
    skipped = 0
    for entry in feed.entries[:50]:
        published = entry.get("published", "")
        if not _is_today(published):
            skipped += 1
            continue
        items.append({
            "source": name,
            "title": entry.get("title", "").strip(),
            "summary": entry.get("summary", "")[:500].strip(),
            "link": entry.get("link", ""),
            "published": published,
        })
        if len(items) >= 20:
            break
    if skipped:
        logger.info(f"  ⏭ {name}: 过滤掉 {skipped} 条非今日新闻")
    return items


async def _async_fetch_url(client: httpx.AsyncClient, url: str) -> str | None:
    """异步抓取单个 URL，返回响应文本或 None"""
    try:
        resp = await client.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True)
        if resp.status_code == 200:
            return resp.text
    except Exception:
        pass
    return None


async def _async_fetch_rss(client: httpx.AsyncClient, name: str, urls: list[str]) -> list[dict]:
    """对一个源的多个 URL 依次尝试（异步），返回第一个成功的结果"""
    for url in urls:
        text = await _async_fetch_url(client, url)
        if text:
            items = _parse_rss_response(name, text)
            if items:
                return items
    return []


async def _async_fetch_api(client: httpx.AsyncClient, name: str, config: dict) -> list[dict]:
    """异步抓取 API 数据"""
    url = config["url"]
    headers = dict(config.get("headers", {}))
    parser_name = config.get("parser", "")

    parser = API_PARSERS.get(parser_name)
    if not parser:
        logger.warning(f"未知的解析器: {parser_name}，跳过 {name}")
        return []

    try:
        resp = await client.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True,
                                headers=headers)
        data = resp.json()
    except Exception as e:
        logger.warning(f"API 抓取失败 {name}: {e}")
        return []

    try:
        raw_items = parser(data)
        return [{"source": name, **item} for item in raw_items]
    except Exception as e:
        logger.warning(f"解析失败 {name}: {e}")
        return []


# ── 社交媒体 API 解析器 ──────────────────────────────


def parse_weibo(data: dict) -> list[dict]:
    """解析微博热搜 API 返回"""
    items = []
    realtime = data.get("data", {}).get("realtime", [])
    for entry in realtime[:20]:
        word = entry.get("word", "").strip()
        if not word:
            continue
        items.append({
            "title": word,
            "summary": entry.get("label_name", ""),
            "link": f"https://s.weibo.com/weibo?q=%23{word}%23",
        })
    return items


def parse_zhihu(data: dict) -> list[dict]:
    """解析知乎热榜 API 返回"""
    items = []
    for entry in data.get("data", [])[:20]:
        target = entry.get("target", {})
        title = target.get("title", "").strip()
        if not title:
            continue
        excerpt = target.get("excerpt", "")[:500]
        qid = target.get("id", "")
        items.append({
            "title": title,
            "summary": excerpt,
            "link": f"https://www.zhihu.com/question/{qid}" if qid else "",
        })
    return items


def parse_bilibili(data: dict) -> list[dict]:
    """解析B站热门 API 返回"""
    items = []
    for entry in data.get("data", {}).get("list", [])[:20]:
        title = entry.get("title", "").strip()
        if not title:
            continue
        items.append({
            "title": title,
            "summary": entry.get("desc", "")[:500],
            "link": entry.get("short_link_v2", "") or f"https://www.bilibili.com/video/{entry.get('bvid', '')}",
        })
    return items


def parse_douyin(data: dict) -> list[dict]:
    """解析抖音热搜 API 返回"""
    items = []
    word_list = data.get("data", {}).get("word_list", [])
    if not word_list:
        word_list = data.get("data", [])
    for entry in word_list[:20]:
        word = entry.get("word", "").strip()
        if not word:
            continue
        items.append({
            "title": word,
            "summary": entry.get("event_time", ""),
            "link": f"https://www.douyin.com/search/{word}",
        })
    return items


API_PARSERS = {
    "weibo": parse_weibo,
    "zhihu": parse_zhihu,
    "bilibili": parse_bilibili,
    "douyin": parse_douyin,
}


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
        logger.warning(f"Firecrawl 抓取失败 {url}: {e}")
        return ""


def _get_urls(config) -> list[str]:
    """从配置中提取 URL 列表，兼容旧格式"""
    if isinstance(config, str):
        return [config]
    if isinstance(config, dict):
        if "urls" in config:
            return config["urls"]
        if "url" in config:
            return [config["url"]]
    return []


# ── 抓取主流程 ────────────────────────────────────────


async def collect_all_news() -> list[dict]:
    """并发抓取所有新闻源"""
    all_news = []
    tasks: list[tuple[str, asyncio.Task]] = []

    async with httpx.AsyncClient(headers={"User-Agent": BROWSER_UA}) as client:
        logger.info("📡 抓取 RSS 新闻源...")
        for name, config in RSS_FEEDS.items():
            urls = _get_urls(config)
            task = asyncio.create_task(_async_fetch_rss(client, name, urls))
            tasks.append((name, task))

        logger.info("📡 抓取社交媒体 & 垂直社区热搜...")
        for name, config in TRENDING_FEEDS.items():
            if isinstance(config, str):
                task = asyncio.create_task(_async_fetch_rss(client, name, [config]))
            elif isinstance(config, dict):
                feed_type = config.get("type", "rss")
                if feed_type == "api":
                    task = asyncio.create_task(_async_fetch_api(client, name, config))
                else:
                    urls = _get_urls(config)
                    task = asyncio.create_task(_async_fetch_rss(client, name, urls))
            else:
                continue
            tasks.append((name, task))

        results = await asyncio.gather(*(t for _, t in tasks), return_exceptions=True)

    for (name, _), result in zip(tasks, results):
        if isinstance(result, Exception):
            logger.error(f"  ✓ {name}: 0 条 [ERROR: {result}]")
        else:
            all_news.extend(result)
            logger.info(f"  ✓ {name}: {len(result)} 条")

    logger.info(f"📊 共抓取 {len(all_news)} 条新闻")
    return all_news


def save_raw_news(all_news: list[dict]) -> None:
    """将抓取到的原始新闻保存到 reports/ 目录"""
    raw_path = REPORTS_DIR / f"{TODAY}-raw.json"
    raw_data = {
        "date": TODAY,
        "total": len(all_news),
        "fetched_at": datetime.now(BJT).isoformat(),
        "news": all_news,
    }
    raw_path.write_text(json.dumps(raw_data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info(f"📋 原始新闻已保存: {raw_path} ({len(all_news)} 条)")

    grouped = defaultdict(list)
    for item in all_news:
        title = item.get("title", "").strip()
        if title:
            grouped[item.get("source", "未知")].append(title)

    lines = [f"# {TODAY} 原始新闻标题 ({len(all_news)} 条)", ""]
    for source, titles in grouped.items():
        lines.append(f"## {source} ({len(titles)} 条)")
        for t in titles:
            lines.append(f"- {t}")
        lines.append("")

    titles_path = REPORTS_DIR / f"{TODAY}-raw-titles.md"
    titles_path.write_text("\n".join(lines), encoding="utf-8")
    logger.info(f"📋 标题摘要已保存: {titles_path}")


def main():
    logger.info(f"🚀 开始抓取 {TODAY} 新闻")

    all_news = asyncio.run(collect_all_news())

    if not all_news:
        logger.warning("未抓取到任何新闻")

    save_raw_news(all_news)
    logger.info(f"✅ 抓取完成，共 {len(all_news)} 条，已保存到 reports/{TODAY}-raw.json")


if __name__ == "__main__":
    main()
