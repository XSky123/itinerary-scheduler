# 行程安排工具

> 这是一个由 **Claude Code 4.6 + Codex 5.6 sol** 纯 vibe coding 完成的试水项目，存在各种奇怪问题的可能。请善用 [Issues](https://github.com/xsky123/itinerary-scheduler/issues) 功能反馈问题。

一个纯前端、约束驱动的可视化行程排程工具。录入一天内的交通班次，在甘特图上调整时间并组合多个计划，应用会实时检查时间冲突并生成可编辑的行程预览。

[在线使用](https://xsky123.github.io/itinerary-scheduler/)

## 功能

- 按交通行管理航班、铁路、巴士、接驳和自定义班次。
- 在甘特图中拖动或缩放班次，按 5 分钟吸附。
- 通过右键菜单将班次加入一个或多个计划。
- 自动按出发时间排序；班次直接重叠时会把连接明确标红。
- 在计划间隙中添加、拖动和缩放自定义事项。
- 候选班次允许重叠并自动分轨，保持备选方案可读。
- 计划事项不会与班次或其他事项重叠；冲突修改会被拒绝并显示原因。
- 支持撤销/恢复、键盘移动、响应式窄屏布局和 CSV 导出。
- 数据仅保存在浏览器 `localStorage`，不上传服务器。

## 拖拽和重叠规则

| 场景 | 行为 |
| --- | --- |
| 班次库中的候选班次重叠 | 允许；同一交通行自动纵向分轨。 |
| 同一计划内的班次直接重叠 | 允许形成备选方案，但连接会被标记为无效。 |
| 班次不重叠但少于建议缓冲 | 当前保持可行；缓冲值用于排程信息，不作为硬阻断。 |
| 事项拖向相邻班次或事项 | 自动限制在当前可用间隙内，不允许覆盖。 |
| 修改班次后会覆盖计划事项 | 拒绝修改并恢复原位置，同时显示冲突原因。 |

## 本地开发

要求 Node.js 20.19+，或 Node.js 22.12+。

```bash
npm ci
npm run dev
```

常用命令：

```bash
npm run type-check   # TypeScript 检查
npm run build        # 类型检查并生成单文件 dist/index.html
npm run check        # 提交前完整检查
npm run preview      # 预览生产构建
```

## 技术栈

- React 18、TypeScript、Zustand、dayjs
- Vite 与 `vite-plugin-singlefile`
- GitHub Actions + GitHub Pages

## 数据与隐私

所有班次、计划、事项和设置都存放在当前浏览器的 `itinerary-scheduler-v1` localStorage 项中。清理站点数据会删除本地计划。

## 发布

GitHub Pages 使用手动工作流 `.github/workflows/deploy-pages.yml`。大版本或主要功能提交后，项目规则要求先询问是否发布 Pages，再手动运行该工作流。

## License

[MIT](LICENSE)
