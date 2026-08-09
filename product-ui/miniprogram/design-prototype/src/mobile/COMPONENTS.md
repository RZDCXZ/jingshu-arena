# 移动运行时与组件契约

本参考文档负责设备外壳、布局、手势、键盘和手机范围内的浮层规则。运行时或组件变更触及哪个章节，就必须满足该章节的全部规则。

## 设备外壳

- 保持 `App` 的组合顺序为 `PhoneFrame` → `KeyboardProvider`，并将 `StatusBar`、应用内容、`HomeIndicator` 和 `KeyboardDock` 放在手机框架内。
- 将 `StatusBar`、iOS 主屏指示条、Pixel 摄像头开孔和 Android 导航栏视为受保护的设备外壳。应用内容自行提供安全区 padding。
- 保留 `iPhone` 和 `Pixel 10` 预设。Pixel 10 使用 `427 × 952` 屏幕、`32 × 32` 摄像头圆形开孔和 `public/assets/android/navigation-bar.svg`。
- 保留右上角紧凑、无边框的设备选择器，包括内容自适应触发器、右对齐菜单、3px inset、细描边和层级阴影。原型根节点和默认应用屏幕保持白色。
- 保持 `StatusBar` 实时运行。Pixel 10 使用 Roboto、Android 指示器以及顶部/侧边 32px padding；iPhone 使用源 iOS 指示器、系统字体和校准间距。除非用户明确要求固定的模拟时间，否则保留运行时时钟；应配置设备外壳，不要在应用标记中重复状态栏内容。
- `PhoneFrame` 负责校准后的框架、屏幕 portal、设备选择器、摄像头开孔和自定义光标。修复 `public/assets/iphone/` 或 `public/assets/android/` 中缺失的资源路径，确保外壳完整。
- Android 在键盘关闭时为导航区保留视口空间。键盘打开后，键盘资源提供 IME 导航条，独立导航栏隐藏。iOS 继续在主屏指示条区域下方绘制。

## 路由与图层

- 简单单屏原型直接使用 `MobileScroll`。
- 常规多屏流程使用 `FlowStack`。将路由定义为 `FlowScreen` 对象，即 `{ id, header?, headerHeight?, footer?, footerHeight?, render }`，并通过 `flow.push`、`flow.pop`、`flow.replace` 或 `useFlow()` 导航。
- 持久输入区、独立展示的 sheet、推入式或 peek 侧栏以及全应用过渡直接在 `Prototype.tsx` 中组合；应用负责的固定外壳应作为 `MobileScroll` 外部的同级图层。
- 路由负责的固定 header 和 footer 分别放入 `FlowScreen.header` 与 `FlowScreen.footer`。`headerHeight` 是可见应用工具栏高度；状态栏 inset 由 `FlowStack` 提供。`footerHeight` 是完整应用 footer 高度。
- `FlowScreen.footer` 会覆盖内容。为对应屏幕提供足够的底部 padding，使最后一项内容能够滚动到 footer 上方，例如 `padding-bottom: calc(var(--flow-footer-height) + var(--mobile-safe-area-height) + 24px)`。
- 固定手机外壳保持静止；推入的屏幕内容可以执行动画。

## 滚动与手势

- 只有应滚动并具有回弹效果的内容放入 `MobileScroll`。Header、导航栏、tab、输入区和浮层保留为同级图层。
- 保持拖动点击抑制：指针移动超过 tap slop 后执行滚动，不触发按钮、链接、卡片或图片。
- 只有极少数必须在所有方向独占拖动的控件才能使用 `data-scroll-drag="ignore"`。
- 保持手机范围内的 `dragstart` 抑制和图片不可拖动样式，避免浏览器原生拖动截获滚动手势。

## 轮播组件

`Carousel` 是卡片、图片、媒体、可滑动项目以及 chip 或筛选轨道的标准横向集合。将它直接放在 `MobileScroll` 中：

```tsx
<MobileScroll>
  <section>
    <Carousel
      ariaLabel="Event details"
      className="event-carousel"
      contentClassName="event-carousel-track"
    >
      {cards}
    </Carousel>
  </section>
</MobileScroll>
```

运行时按轴向解决嵌套手势：横向意图交给 `Carousel`，纵向意图交给父级 `MobileScroll`。完成拖动后抑制项目点击。

释放后的运动由 `Carousel` 负责：不要在外围增加自定义 pointer 包装、`data-scroll-drag="ignore"` 或 CSS scroll snapping。

## 键盘感知输入与内边距（inset）

- 所有文本输入控件使用 `KeyboardInput`、`KeyboardTextarea` 或 `MobileTextField`。
- `MobileScroll` 内的普通内容不需要添加 `var(--keyboard-height)` padding，因为视口已经缩小到键盘上方。
- 固定输入区、搜索表面和键盘联动外壳根据 `useKeyboardInsets().bottomInset` 定位。Android 在键盘关闭且视口已预留导航区时返回 `0`，键盘打开时返回键盘高度；iOS 在关闭时清除主屏指示条高度，打开时贴在键盘上方。
- 关闭键盘联动表面时，在同一个事件中先调用 `keyboard.hide()`，再改变表面的打开状态。位置应绑定 inset，不要使用定时器或独立可见性标记。
- 导航、sheet、对话框、菜单或过渡的目标不应继承焦点时，先关闭键盘。`FlowStack` 已在 `push`、`pop` 和 `replace` 时执行该操作；`BottomSheet` 已在打开前执行。
- 失焦时关闭键盘；但如果焦点直接移到同一键盘会话中的另一个文本输入控件，则保持键盘。

## 底部面板

手机范围内的 sheet 使用 `BottomSheet`。其 props 包括 `open`、`onOpenChange`、`title`、可选的 `description`、可选的 `snap` 和 `children`。它通过手机屏幕 portal 渲染，在打开前关闭键盘，并负责进入与退出动画；调用方通过 `onOpenChange` 控制 `open`。

## 图层顺序

- 普通应用 UI 位于可见键盘下层。
- 键盘位于主屏指示条和安全区图层下层。
- 主屏指示条始终是手机安全区内的最上层。

当上述受影响的外壳和组件规则在两个设备预设上都成立、交互测试通过且受保护运行时锁与已验证文件一致时，运行时工作才算完成。
