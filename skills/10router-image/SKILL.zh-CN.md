---
name: 10router-image
description: 通过 10Router /v1/images/generations 生成图片，支持 OpenAI / Gemini Imagen / DALL-E / FLUX / MiniMax / SDWebUI / ComfyUI / Codex 等模型。当用户想要创建、生成、绘制或渲染一张图片、照片，或进行文生图（txt2img）时使用。
---

# 10Router — 图片生成

需要 `TENROUTER_URL`（若启用鉴权还需 `TENROUTER_KEY`）。安装配置参见 https://raw.githubusercontent.com/techysy/10router/main/skills/10router/SKILL.md。

## 发现模型

```bash
curl $TENROUTER_URL/v1/models/image | jq '.data[].id'
# 各模型的参数/选项（size 枚举、quality 枚举、能力如 edit）
curl "$TENROUTER_URL/v1/models/info?id=openai/dall-e-3"
```

## 端点

`POST $TENROUTER_URL/v1/images/generations`

| 字段 | 必填 | 说明 |
|---|---|---|
| `model` | 是 | 来自 `/v1/models/image` |
| `prompt` | 是 | 图片描述 |
| `n` | 否 | 数量（取决于 provider） |
| `size` | 否 | `1024x1024`、`1792x1024` 等 |
| `quality` | 否 | `standard` / `hd`（OpenAI） |
| `response_format` | 否 | `url`（默认）或 `b64_json` |

添加查询参数 `?response_format=binary` 可返回原始图片字节（便于保存为文件）。

## 示例

保存为文件（二进制）：

```bash
curl -X POST "$TENROUTER_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer ***" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini/gemini-3-pro-image-preview","prompt":"watercolor mountains at sunrise","size":"1024x1024"}' \
  --output out.png
```

JS（URL 响应）：

```js
const r = await fetch(`${process.env.TENROUTER_URL}/v1/images/generations`, {
  method: "POST",
  headers: { "Authorization": `Bearer ${process.env.TENROUTER_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ model: "gemini/gemini-3-pro-image-preview", prompt: "neon city", size: "1024x1024" }),
});
const { data } = await r.json();
console.log(data[0].url || data[0].b64_json.slice(0, 40));
```

## 响应结构

JSON（默认 `response_format=url`）：
```json
{ "created": 1735000000, "data": [{ "url": "https://..." }] }
```

`response_format=b64_json`：
```json
{ "created": 1735000000, "data": [{ "b64_json": "iVBORw0KGgo..." }] }
```

查询参数 `?response_format=binary` 返回原始图片字节（Content-Type 为 `image/png` 或 `image/jpeg`）。

## Provider 特性

以上通用字段在所有 provider 均适用。以下为各 provider 额外新增或覆盖的字段：

| Provider | 额外/变更字段 | 说明 |
|---|---|---|
| `openai`、`minimax`、`openrouter`、`recraft` | `quality`、`style`、`response_format` | 标准 OpenAI 结构 |
| `gemini`（nano-banana） | — | 仅支持 `prompt`；忽略 `size`/`n` |
| `codex`（gpt-5.5-image） | `image`、`images[]`、`image_detail`、`output_format`、`background` | SSE 流式；**需要 ChatGPT Plus/Pro** |
| `huggingface` | — | 仅支持 `prompt`；返回单张图片 |
| `nanobanana` | `image`、`images[]`（编辑模式） | `size` → 宽高比；异步轮询 |
| `fal-ai` | `image`（图生图） | `n` → `num_images`；`size` → 比例；异步 |
| `stability-ai` | `style`（预设）、`output_format` | `size` → `aspect_ratio` |
| `black-forest-labs`（FLUX） | `image`（参考图） | `size` → 精确的 `width`/`height`；异步 |
| `runwayml` | `image`（参考图） | `size` → 比例；异步；还存在视频模型 |
| `sdwebui`、`comfyui` | — | 本地无鉴权（`:7860` / `:8188`） |
