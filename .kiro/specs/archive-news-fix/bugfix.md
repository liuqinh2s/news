# Bugfix 需求文档

## 简介

归档新闻模块存在两个缺陷：（1）日期格式化函数 `formatDate` 只返回年月，缺少日部分；（2）归档新闻条目没有绑定点击事件，无法像近三天新闻卡片一样点击查看详情弹窗。这两个问题导致归档区域的用户体验明显弱于近三天新闻区域。

## Bug 分析

### 当前行为（缺陷）

1.1 WHEN 归档新闻条目渲染日期时调用 `formatDate("2026-03-28")` THEN 系统只显示 `2026.03`，缺少日部分（`28`）

1.2 WHEN 用户点击归档新闻条目 THEN 系统没有任何响应，无法查看新闻详情

1.3 WHEN `loadData` 构建归档数据时 THEN 系统只保存了 `title` 和 `date`，没有保存完整的新闻对象（如 `summary`、`impact_level`、`impact_areas`、`sources`、`reason`），导致即使绑定了点击事件也无法展示详情

### 期望行为（正确）

2.1 WHEN 归档新闻条目渲染日期时调用 `formatDate("2026-03-28")` THEN 系统 SHALL 显示完整的 `2026.03.28`，包含年、月、日

2.2 WHEN 用户点击归档新闻条目 THEN 系统 SHALL 弹出详情弹窗（调用 `showModal`），展示与近三天新闻卡片相同的详情内容

2.3 WHEN `loadData` 构建归档数据时 THEN 系统 SHALL 保存完整的新闻对象，以便点击时能传递给 `showModal` 函数

### 不变行为（回归预防）

3.1 WHEN 近三天新闻卡片渲染时 THEN 系统 SHALL CONTINUE TO 正常显示新闻卡片并支持点击查看详情弹窗

3.2 WHEN 近三天新闻卡片调用 `formatDate` 时 THEN 系统 SHALL CONTINUE TO 正确格式化日期（修复后将同样显示完整年月日）

3.3 WHEN 新闻数据为空或加载失败时 THEN 系统 SHALL CONTINUE TO 显示相应的空状态提示信息

3.4 WHEN 用户点击弹窗关闭按钮、遮罩层或按 Escape 键时 THEN 系统 SHALL CONTINUE TO 正常关闭弹窗
