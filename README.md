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

### 端侧 SAM 2 实验

面板底部的“端侧 SAM 2 首帧点选（实验）”默认折叠且不加载任何模型。主动点击“加载并编码首帧”后，浏览器会下载约 151 MB 的 SAM 2 Tiny 编码器和解码器，并在 Web Worker 中优先使用 WebGPU；完成后可在首帧点击，比较模型给出的候选轮廓。

这个实验只验证本地点选分割：候选不会自动传播到后续帧，也不会覆盖示例自带的逐帧跟踪结果。因此视频换色仍使用 `example-tracks.json`，不会因开启实验模式而变差。

## 内容

- `assets/example.mp4`：2 秒、640×360、24fps 的示例视频。
- `assets/example-tracks.json`：三个目标各 48 帧的独立 RLE 跟踪结果。
- `example.js`：本地播放、点选与参数保存逻辑。
- `sam2-worker.js`：按需加载的 SAM 2 Tiny ONNX Runtime Web Worker。
- `renderer.js`：WebGPU 合成和 WebGL 2 回退。

示例视频来自 [fal 公开示例素材](https://storage.googleapis.com/falserverless/example_inputs/birefnet-video-input.mp4)。示例只复用已有视频片段和跟踪结果，没有重新生成图像或重打光。
