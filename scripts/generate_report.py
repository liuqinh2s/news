from __future__ import annotations

"""
新闻日报生成脚本（兼容入口）
依次执行：1. 抓取新闻  2. AI 筛选生成日报

等价于分别运行：
    python scripts/fetch_news.py
    python scripts/ai_filter.py

也可以单独运行某一步，例如只重跑 AI 筛选（不重新抓取）：
    python scripts/ai_filter.py
"""

import subprocess
import sys
from pathlib import Path


def main():
    scripts_dir = Path(__file__).parent

    # 1. 抓取新闻
    result = subprocess.run([sys.executable, str(scripts_dir / "fetch_news.py")],
                            cwd=scripts_dir.parent)
    if result.returncode != 0:
        print(f"[ERROR] fetch_news.py 执行失败 (exit code {result.returncode})")
        sys.exit(result.returncode)

    # 2. AI 筛选生成日报
    result = subprocess.run([sys.executable, str(scripts_dir / "ai_filter.py")],
                            cwd=scripts_dir.parent)
    if result.returncode != 0:
        print(f"[ERROR] ai_filter.py 执行失败 (exit code {result.returncode})")
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
