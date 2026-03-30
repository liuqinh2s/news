from __future__ import annotations

"""
新闻抓取 + AI 筛选脚本
1. 从 RSS 源抓取新闻
2. 从社交媒体/垂直社区抓取热搜
3. AI 大模型筛选重大新闻并生成摘要
4. 输出 Markdown 日报到 reports/ 目录
"""

import asyncio
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

PROMPTS_DIR = Path("prompts")
CONFIG_DIR = Path("config")

ZHIPU_API_KEY = os.environ.get("ZHIPU_API_KEY", "")
FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "")

BJT = timezone(timedelta(hours=8))
TODAY = datetime.now(BJT).strftime("%Y-%m-%d")

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
REQUEST_TIMEOUT = 10  # 单个请求超时（秒）


def _is_today(published_str: str) -> bool:
    """判断 RSS 条目的发布时间是否为今天（北京时间）"""
    if not published_str:
        return True  # 没有发布时间的条目保留，交给 AI 判断

    from email.utils import parsedate_to_datetime

    try:
        # 尝试 RFC 2822 格式（RSS 标准格式）
        dt = parsedate_to_datetime(published_str)
        dt_bjt = dt.astimezone(BJT)
        return dt_bjt.strftime("%Y-%m-%d") == TODAY
    except Exception:
        pass

    # 尝试常见的日期格式
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

    # 最后检查日期字符串中是否直接包含今天的日期
    if TODAY in published_str:
        return True

    # 无法解析的保留，交给 AI 判断
    return True


def _parse_rss_response(name: str, text: str) -> list[dict]:
    """解析 RSS 响应文本，返回新闻列表（只保留今天的新闻）"""
    feed = feedparser.parse(text)
    items = []
    skipped = 0
    for entry in feed.entries[:50]:  # 多取一些，因为会过滤掉旧的
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
        print(f"  ⏭ {name}: 过滤掉 {skipped} 条非今日新闻")
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
        print(f"[WARN] 未知的解析器: {parser_name}，跳过 {name}")
        return []

    try:
        resp = await client.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True,
                                headers=headers)
        data = resp.json()
    except Exception as e:
        print(f"[WARN] API 抓取失败 {name}: {e}")
        return []

    try:
        raw_items = parser(data)
        return [{"source": name, **item} for item in raw_items]
    except Exception as e:
        print(f"[WARN] 解析失败 {name}: {e}")
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
        # 兼容另一种返回结构
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
        print(f"[WARN] Firecrawl 抓取失败 {url}: {e}")
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


async def collect_all_news() -> list[dict]:
    """并发抓取所有新闻源"""
    all_news = []
    tasks: list[tuple[str, asyncio.Task]] = []

    async with httpx.AsyncClient(headers={"User-Agent": BROWSER_UA}) as client:
        # 创建所有抓取任务
        print("📡 抓取 RSS 新闻源...")
        for name, config in RSS_FEEDS.items():
            urls = _get_urls(config)
            task = asyncio.create_task(_async_fetch_rss(client, name, urls))
            tasks.append((name, task))

        print("📡 抓取社交媒体 & 垂直社区热搜...")
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

        # 等待所有任务完成
        results = await asyncio.gather(*(t for _, t in tasks), return_exceptions=True)

    for (name, _), result in zip(tasks, results):
        if isinstance(result, Exception):
            print(f"  ✓ {name}: 0 条 [ERROR: {result}]")
        else:
            all_news.extend(result)
            print(f"  ✓ {name}: {len(result)} 条")

    print(f"\n📊 共抓取 {len(all_news)} 条新闻")
    return all_news


# ── AI 筛选 ───────────────────────────────────────────


def load_prompt(filename: str) -> str:
    """从 prompts/ 目录加载提示词文件"""
    path = PROMPTS_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"提示词文件不存在: {path}")
    return path.read_text(encoding="utf-8").strip()


def repair_json(text: str) -> str:
    """尝试修复常见的 JSON 格式问题"""
    # 去除可能的 markdown 代码块标记
    text = re.sub(r'^```(?:json)?\s*', '', text.strip())
    text = re.sub(r'\s*```$', '', text.strip())
    # 修复中文引号
    text = text.replace('\u201c', '"').replace('\u201d', '"')
    text = text.replace('\u2018', "'").replace('\u2019', "'")
    # 修复未转义的换行符（在字符串值内部的真实换行）
    # 匹配 "key": "...内容中的换行..." 这种情况
    text = re.sub(r'(?<=": ")(.*?)(?=")', lambda m: m.group(0).replace('\n', '\\n'), text, flags=re.DOTALL)
    return text


def parse_json_response(content: str) -> "list[dict] | None":
    """从 AI 返回内容中提取并解析 JSON，带容错处理"""
    # 提取 [...] 部分
    json_match = re.search(r'\[.*\]', content, re.DOTALL)

    # 如果找不到完整的 [...], 可能是被截断了，尝试找 [ 开头的部分
    if not json_match:
        json_match = re.search(r'\[.*', content, re.DOTALL)
    if not json_match:
        return None

    raw = json_match.group()

    # 第一次尝试：直接解析
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 第二次尝试：修复后解析
    try:
        repaired = repair_json(raw)
        return json.loads(repaired)
    except json.JSONDecodeError:
        pass

    # 第三次尝试：截断修复 — 找到最后一个完整的 },  截断并闭合数组
    try:
        # 找到所有顶层对象的结束位置 (}, 或 } 后跟 ])
        last_complete = -1
        depth = 0
        in_string = False
        escape_next = False
        for i, ch in enumerate(raw):
            if escape_next:
                escape_next = False
                continue
            if ch == '\\' and in_string:
                escape_next = True
                continue
            if ch == '"' and not escape_next:
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    last_complete = i

        if last_complete > 0:
            truncated = raw[:last_complete + 1].rstrip().rstrip(',') + ']'
            try:
                result = json.loads(truncated)
                if result:
                    print(f"[INFO] JSON 被截断，成功恢复 {len(result)} 条完整记录")
                    return result
            except json.JSONDecodeError:
                repaired = repair_json(truncated)
                try:
                    result = json.loads(repaired)
                    if result:
                        print(f"[INFO] JSON 被截断，修复后恢复 {len(result)} 条完整记录")
                        return result
                except json.JSONDecodeError:
                    pass
    except Exception:
        pass

    # 第四次尝试：逐个对象提取（兜底）
    try:
        objects = re.findall(r'\{[^{}]*\}', raw, re.DOTALL)
        results = []
        for obj_str in objects:
            try:
                obj = json.loads(repair_json(obj_str))
                if "title" in obj and "summary" in obj:
                    results.append(obj)
            except json.JSONDecodeError:
                continue
        if results:
            return results
    except Exception:
        pass

    return None


def ai_filter_news(news_items: list[dict]) -> list[dict]:
    """用 AI 大模型筛选重大新闻"""
    if not ZHIPU_API_KEY:
        print("[ERROR] 未设置 ZHIPU_API_KEY，跳过 AI 筛选")
        return []

    # 加载提示词
    system_prompt = load_prompt("filter_news.md")
    user_prompt_template = load_prompt("filter_news_user.md")

    # 构建新闻摘要文本
    news_text = ""
    for item in news_items:
        news_text += f"【{item['source']}】{item['title']}\n"
        if item['summary']:
            news_text += f"  摘要: {str(item['summary'])[:200]}\n"
        if item.get('link'):
            news_text += f"  链接: {item['link']}\n"
        news_text += "\n"

    # 控制上下文长度
    if len(news_text) > 50000:
        news_text = news_text[:50000] + "\n...(已截断)"

    user_prompt = user_prompt_template.format(
        date=TODAY,
        count=len(news_items),
        news_text=news_text,
    )

    client = OpenAI(
        api_key=ZHIPU_API_KEY,
        base_url="https://open.bigmodel.cn/api/paas/v4",
    )

    print("🤖 AI 正在筛选重大新闻...")
    try:
        response = client.chat.completions.create(
            model="glm-4-plus",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=8192,
        )
        content = response.choices[0].message.content.strip()
        result = parse_json_response(content)
        if result is not None:
            print(f"✅ AI 筛选出 {len(result)} 条重大新闻")
            return result
        else:
            print("[WARN] AI 返回内容无法解析为 JSON")
            print(f"[DEBUG] 原始返回:\n{content[:500]}")
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
        reason = news.get("reason", "")
        if reason:
            lines.append(f"> 🤖 AI筛选原因：{reason}")
            lines.append("")
        if sources:
            source_parts = []
            for s in sources:
                if isinstance(s, dict):
                    name = s.get("name", "")
                    url = s.get("url", "")
                    source_parts.append(f"[{name}]({url})" if url else name)
                else:
                    source_parts.append(str(s))
            lines.append(f"*来源: {', '.join(source_parts)}*")
            lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


# ── 主流程 ────────────────────────────────────────────

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
    print(f"📋 原始新闻已保存: {raw_path} ({len(all_news)} 条)")

    # 按来源分组，只保留标题，方便快速浏览
    from collections import defaultdict
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
    print(f"📋 标题摘要已保存: {titles_path}")


def main():
    print(f"🚀 开始生成 {TODAY} 新闻日报\n")

    # 1. 并发抓取所有新闻
    all_news = asyncio.run(collect_all_news())

    if not all_news:
        print("[WARN] 未抓取到任何新闻，生成空报告")

    # 1.5 保存原始新闻
    save_raw_news(all_news)

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
