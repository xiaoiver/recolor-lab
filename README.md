# Recolor Lab · 视频换色示例

一个无需模型账号的浏览器实验页：打开后即可对示例视频中的衬衫、外套和右侧柔光箱分别换色。视频和逐帧跟踪 mask 都随仓库提供，运行时不上传内容，也不请求云端模型。

## 运行

需要通过 HTTP 服务打开：

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

访问 <http://127.0.0.1:8000/>。不需要安装 npm 依赖或配置 API Key。

## 使用

- 点击视频中的目标，或使用“衬衫 / 外套 / 柔光箱”按钮切换；重叠时优先命中实际面积较小的 mask。
- 用色轮、Hex 输入框或预设颜色修改当前目标。每个目标独立保存颜色、亮度、强度和边缘参数。
- 默认静音循环播放，可切换换色、对比、原片与选区视图，或保存当前画面为 PNG。

## 内容

- `assets/example.mp4`：2 秒、640×360、24fps 的示例视频。
- `assets/example-tracks.json`：三个目标各 48 帧的独立 RLE 跟踪结果。
- `example.js`：本地播放、点选与参数保存逻辑。
- `renderer.js`：WebGPU 合成和 WebGL 2 回退。

示例视频来自 [fal 公开示例素材](https://storage.googleapis.com/falserverless/example_inputs/birefnet-video-input.mp4)。示例只复用已有视频片段和跟踪结果，没有重新生成图像或重打光。
