"""
构建脚本：将 reports/ 下的日报数据整理到 site/data/ 供前端读取
- reports-index.json: 所有日报的索引（日期 + 标题列表）
- 每日 JSON 和 Markdown 复制到 site/data/
"""

import json
import shutil
from pathlib import Path

REPORTS_DIR = Path("reports")
SITE_DATA_DIR = Path("site/data")
SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)


def build():
    index = []

    # 遍历所有 JSON 日报
    for json_file in sorted(REPORTS_DIR.glob("*.json"), reverse=True):
        date = json_file.stem
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            news_titles = [n.get("title", "") for n in data.get("news", [])]
            index.append({
                "date": date,
                "titles": news_titles,
                "count": len(news_titles),
            })
            # 复制 JSON 到 site/data/
            shutil.copy2(json_file, SITE_DATA_DIR / json_file.name)
        except Exception as e:
            print(f"[WARN] 解析失败 {json_file}: {e}")

        # 复制对应的 Markdown
        md_file = REPORTS_DIR / f"{date}.md"
        if md_file.exists():
            shutil.copy2(md_file, SITE_DATA_DIR / md_file.name)

    # 写入索引
    index_path = SITE_DATA_DIR / "reports-index.json"
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ 构建完成: {len(index)} 份日报, 索引已写入 {index_path}")


if __name__ == "__main__":
    build()
