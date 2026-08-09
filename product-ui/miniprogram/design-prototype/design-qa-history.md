# 小程序设计 QA 历史

本文件保留已经解决的问题，供回归调查使用。当前有效性、待处理问题、验证矩阵和交付结果以 [`design-qa.md`](design-qa.md) 为准。

## 第 1 轮

- 证据：`design/qa-comparison-pass1.png`
- [P2] 首页当前步骤使用青柠色，偏离源视觉的青色流程语义。
- [P2] 首页主按钮为纯色，缺少源视觉的轻微横向亮度变化。
- 修复：在 `src/prototype.css` 将当前步骤映射到 `--js-cyan`，并给 `.primary-button` 加入受控青柠渐变。

## 第 2 轮

- 证据：`design/qa-comparison-pass2.png` 与 `design/qa-comparison-focus-pass2.png`
- 结果：先前两项 P2 已消除；没有新的可操作 P0/P1/P2 差异。

## 第 3 轮 · 浏览器批注回归

- 证据：`design/qa-comparison-pass3.png`、`design/qa-comparison-focus-pass3.png` 与四张 `design/annotation-*-final.png`。
- [P1] 首页底部时间面板和 MP-05 只给少量预设时刻，不能自由选择契约允许的半小时时段。
  - 修复：两处统一为未来 7 天日期条、00–23 时滚动选择、00/30 分单选、前后 30 分钟微调与实时结束时间；今天已过去片段禁用。
- [P1] 时长与机型底部面板会同时绘制默认项和当前项两个勾选状态。
  - 修复：时长改为唯一数值的步进器 + 1–8 小时滑杆；门店、机型和 MP-05 区域/机型统一为真实单选状态，任一组只有一个 `aria-checked=true`。
- [P2] 重复点击当前底部 Tab 会再次执行根页面替换。
  - 修复：当前 Tab 点击直接不执行动作；浏览器回归中连续点击两次前后 `.flow-screen` 均保持 `1`，切换到其他 Tab 后重复点击也保持 `1`。
- 结果：四条批注均关闭；没有新的可操作 P0/P1/P2 差异。

## 交互 QA 修复

- [P1] 点击靠近屏幕底部的行动后，浏览器焦点会让模板设备容器产生 `scrollTop`，导致下一屏状态栏和标题被裁切。
  - 修复：仅对包含竞枢原型的 `.device-screen` 使用 `overflow: clip`，业务滚动仍由 `MobileScroll` 承担。
  - 修复后证据：`design/interaction-seat-map-final.png`；设备 `scrollTop = 0`，状态栏、标题和固定确认栏完整。
- [P1] 购物车添加第三件商品后，MP-11 内容显示 ¥25.00，但固定提交栏仍写死 ¥13.00。
  - 修复：订单提交栏、详情和行程摘要统一由当前购物车快照计算商品合计、¥5 体验券与应付金额。
  - 修复后证据：`design/interaction-order-confirm-final.png`；内容区和固定栏均为 ¥25.00。
