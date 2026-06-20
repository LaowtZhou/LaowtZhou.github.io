---
name: laowantong-text-to-video
description: Use when converting 老顽童周老师口播稿、SRT 字幕、公众号长文、专栏草稿或视频脚本文案 into Remotion 文生视频、SRT 精确时间轴分镜、AI 分镜图提示词、批量图片资产、或可预览的解释类视频样片。
---

# 老顽童文生视频

## Overview

把老顽童内容从“口播稿/SRT”变成“可渲染的视频工程”。核心原则：**SRT 管时间，AI 图管主视觉，Remotion 管标题/关键词/镜头运动和最终渲染；不要在 Remotion 里烧录口播字幕**。

## Workflow

1. **确认输入**
   - 优先使用 SRT 做时间轴；若同时有 MD/口播稿，时间轴以 SRT 为准。
   - 用 MD/原稿校准 SRT 里的同音错字、专有名词和明显转写错误，但只做文字校准。
   - 校准时不增加句子、不减少句子、不重写表达、不把口播强行改成 100% 文稿。人类真实讲话允许有口语化偏离。
   - 不改文章正文，除非用户明确要求改稿。
   - 明确视频比例、风格参考图、目标片段范围、是否先做样片。

2. **拆分分镜**
   - 不机械每 5 秒一张图；按 SRT 时间和语义转折合并。
   - 样片优先取前 30-60 秒，通常 5-10 张图。
   - 每段数据至少包含：`start`, `end`, `srtRange`, `voiceText`, `imageFile`, `overlayTitle`, `overlayKeywords`, `motion`, `prompt`。
   - 分段不是一次定稿。正式片应先注册 Part compositions，让用户逐段审片；根据用户反馈调整 Part 边界、切图点和补图，不要一上来只给整片成品。
   - 语义转折优先于整段 SRT 编号。若同一条 SRT 同时包含“上一段收尾 + 下一段开头”，应拆成两个视觉 scene，保留同一 `srtRange` 也可以。

3. **生成图片**
   - 图片只生成场景、小人、隐喻物件；中文标题、关键词、必要标注由 Remotion 叠加。
   - Remotion 默认不生成、不烧录逐句口播字幕；字幕交给用户后期软件另加。
   - 提示词要明确：`no readable text, no watermark, no logo`。
   - 项目资产固定放在 Remotion 项目的 `public/generated-frames/`。
   - 横屏视频若存在 API/CLI 高分辨率生成路径，图片最低必须是 `1920x1080`；优先生成 `2048x1152` 或 `3840x2160`，再由 Remotion 缩放到输出尺寸。
   - 竖屏视频图片最低必须是 `1080x1920`；优先生成 `1152x2048` 或 `2160x3840`。
   - 若没有可用 API/CLI 高分辨率生成路径，可使用内置 `image_gen` 的原生输出作为正式资产；当前已验证的 `1672x941` 横屏尺寸可以接受，但必须在 manifest 记录实际尺寸、生成方式和这是内置路径。
   - 若用户明确要求“严格 1920x1080 以上”或已提供 API/CLI 高分辨率路径，内置低分辨率图不能直接作为最终视频资产；必须重新生成高分辨率版本，或先明确标为样片/占位。
   - **硬规则：每生成成功 1 张，立刻无损保存到本地，再生成下一张。** 不要等整批生成完再统一保存。

4. **保存内置 imagegen 结果**
   - 内置 `image_gen` 的图片可能不在普通文件路径里，而在 Codex session JSONL 的 `image_generation_call.result` base64 字段里。
   - 若生成图没有出现在 `~/.codex/generated_images`，使用 `scripts/extract_imagegen_results.py` 从 session JSONL 解码落盘。
   - 长视频任务必须维护 `public/generated-frames/manifest.json`：记录每张图的 scene id、目标文件名、prompt、生成状态、imagegen call id、保存时间。
   - 任何对话压缩、Token 用尽、命令中断或渲染失败后，先读 manifest 和目录文件，只补缺失项，不重做已成功保存的图片。
   - 用户审片后要求补图时，生成一张就立即复制到当前视频项目的 `public/generated-frames/final/`，使用稳定新文件名，例如 `scene-074-market-revalue-job-change-v2.png`；不要覆盖旧图，旧图可能仍被其他 Part 复用。
   - 补图也必须追加或更新 manifest：记录 filename、status、bytes、width、height、callId、savedAt、prompt。manifest 是长任务恢复和资产审计的准绳。

5. **接入 Remotion**
   - 使用 `staticFile(scene.imageFile)` 读取 `public/` 下资产。
   - 用 `Sequence from={secondsToFrames(scene.start)}` 保持 SRT 绝对时间，不要用 `Series` 压掉字幕间隙。
   - 图片做慢推拉/轻微平移；只叠加标题、关键词、图中箭头/标签等视觉信息。
   - 不要添加底部逐字/逐句字幕条，不要把 `voiceText` 直接渲染成字幕。
   - 注册分段 composition：如 `Video-Part01-*`、`Video-Part02-*`，方便用户在 Remotion Studio 逐段看、逐段修。整片 composition 只作为最终合成。
   - 切图要帧级连续：用 `fromFrame = secondsToFrames(visualStart - partStart)`、`endFrame = secondsToFrames(visualEnd - partStart)`、`durationInFrames = endFrame - fromFrame`，不要分别四舍五入 `from` 和秒级 duration，否则切图处可能露出 1 帧白底。
   - 当用户说“某段多了/少了 1 秒左右”，优先微调相邻 Part 的 `start/end`，不要改 SRT 原文。
   - 同一张图可在相邻 Part 复用，但标题可能要按 Part 语义覆盖。使用 `SEGMENT_TITLE_OVERRIDES` 一类的局部标题覆盖，不要为了一个标题去复制图片或重写全局分镜。
   - 禁止左侧大白蒙版、全画面浅白罩层和调试用 `SRT xx-xx` 字样进入正式预览。需要文字时只叠加中文标题和关键词；英文标题必须翻译成中文。
   - 如果新 scene id 采用 `scene-074b` 这类拆分编号，Remotion 的 scene number 解析必须用 `parseInt`，不要用 `Number(scene.id.replace(...))`，否则新 scene 会被过滤掉。

6. **验证**
   - 跑 `npm run lint`。
   - 渲染 2-4 张 still：开头、中段、关键切换点。
   - 渲染样片 MP4，确认使用的是生成图而不是参考图占位。
   - 检查所有 `generated-frames` 图片尺寸，不低于最终视频尺寸；低于目标尺寸时不要进入全片渲染。
   - 每次调整 Part 边界后，跑 `npx remotion compositions` 检查分段时长变化是否符合预期。
   - 每次修切图后，用脚本检查相邻 visual scene 是否有帧间隙；输出应类似 `No frame gaps between storyboard images.`
   - 用户指出某个时间点不对时，渲染该时间点前后 still，而不是只看开头图。

## Review And Repair Loop

用户逐段审片时，按这个顺序处理反馈：

1. **先判断问题类型**
   - 语音段落归属错：调 Part `start/end` 和 `sceneStart/sceneEnd`。
   - 图片语义不贴：先看是否已有合适图片；没有再生成补图。
   - 同一 SRT 内语义转折：拆分视觉 scene，例如 `scene-074` + `scene-074b`。
   - 标题/关键词误导：优先改 overlay 或加 segment override，不重做图片。
   - 切图白闪：检查帧级连续，不靠加转场掩盖。

2. **修复时保持可回退**
   - 不覆盖旧图，不删除旧图。
   - 新图用 `-v2` 或语义化新文件名。
   - 修改 JSON 前先定位相关 scene，避免批量改动无关段落。
   - 一个反馈只解决一个问题，避免顺手重切全片。

3. **修后验证**
   - 跑 lint。
   - 渲染用户指出时间点的 still。
   - 刷新对应 Part composition，而不是只打开整片。
   - 简短说明改了哪个切点、哪张图、哪段时长。

## Project Structure

`remotion-animation` 是多个视频的工作区，不要把共享依赖、模板和单条视频资产混在一起。

Recommended layout:

```text
remotion-animation/
  package.json
  package-lock.json
  node_modules/
  remotion.config.ts
  tsconfig.json
  src/
    shared/
      components/
      styles/
      utils/
  videos/
    salary-average/
      public/
        generated-frames/
        reference-images/
      src/
        StoryboardComposition.tsx
        storyboard.ts
      out/
      README.md
```

Rules:

- Shared Node/Remotion dependencies live at `remotion-animation/` root.
- Each video gets its own folder under `remotion-animation/videos/<video-slug>/`.
- Per-video generated images, reference images, SRT-derived storyboard data, preview stills, and final MP4s stay inside that video folder.
- Shared components/utilities live under root `src/shared/`; per-video code imports them instead of copying.
- Do not create `node_modules` inside every video folder unless there is a deliberate reason to isolate a project.
- Existing older single-project folders may remain, but new videos should follow the shared-root layout.

## Prompt Pattern

```text
Use case: stylized-concept
Asset type: Remotion video storyboard frame, 16:9 landscape
Output size: at least 2048x1152 for 16:9 landscape, preferably 3840x2160 for final assets
Primary request: <本段口播对应的画面隐喻>
Style/medium: miniature tabletop 3D diorama, warm desk lamp, soft shadows, ivory paper surface, simple black hand-drawn stick figures as physical wire/ink-line characters, delicate translucent glow trails, clean educational explainer style
Composition/framing: one clear focal metaphor, generous negative space for later Chinese overlay text, no clutter, no dense UI
Text: no readable text anywhere in the generated image
Constraints: no watermark, no logo, no subtitles, no Chinese text, no English text, no numbers, no realistic human faces, no chalkboard style, no dark black background, no cartoon Q-version character
```

## Reusable Script

Use this immediately after each successful `image_gen` call when generated images are visible in the chat but not available as files:

```bash
python .agents/skills/laowantong-text-to-video/scripts/extract_imagegen_results.py \
  --session C:/Users/Alex/.codex/sessions/YYYY/MM/DD/rollout-...jsonl \
  --out-dir C:/path/to/remotion-project/public/generated-frames \
  --count 1 \
  --prefix scene \
  --start-index 17 \
  --min-width 1672 \
  --min-height 941
```

The script extracts the latest matching `image_generation_call.result` PNGs and writes stable files such as `scene-017.png`. For one-by-one saving, pass `--count 1` and the exact next `--start-index`.

## Long-Task Safety Rules

- Treat generated images as volatile until they exist under `public/generated-frames/`.
- After each save, verify file size is nonzero and starts with a PNG header.
- Verify dimensions immediately after saving. Prefer `1920x1080+`; when no API/CLI high-resolution path is available and the user accepts native `image_gen`, `1672x941` can be used for horizontal videos, with actual dimensions recorded in manifest.
- Update or create `manifest.json` before continuing to the next image.
- Render preview stills in batches, not only at the end.
- If interrupted, resume from the first storyboard item whose `imageFile` is missing or whose manifest status is not `saved`.
- Never rely on chat-visible images, session memory, or unparsed JSONL as the only copy of assets.
- 正式长片要预期反复返修：把 Remotion 的 source、storyboard JSON、generated frames、manifest、preview stills 都留在视频项目目录里，用户导出后仍可继续微调。

## Common Mistakes

- Do not bake Chinese text into generated images; wrong characters are expensive to fix.
- Do not burn spoken subtitles into Remotion output unless the user explicitly asks. The user will add captions in post-production.
- Do not use `Series` for SRT-exact timing if there are gaps between subtitle ranges.
- Do not leave project images only in Codex default storage or chat cards; copy or decode them into `public/generated-frames/`.
- Do not generate many images in a row before saving the earlier ones.
- Do not accept undersized images as final assets for 1080p/4K output when a high-resolution path is available or when the user has explicitly required `1920x1080+`; otherwise native `image_gen` output such as `1672x941` is acceptable if the user has approved that fallback.
- Do not overwrite reference images. Treat user-provided images as style references unless they explicitly ask to edit them.
- Do not turn a sample into full-video generation before the first 30-60 seconds are visually approved.
- Do not assume Part boundaries are correct just because SRT ranges are correct; spoken sentences often contain transitions inside one SRT item.
- Do not reuse a transition image in the next Part if its metaphor belongs to the previous Part; generate or select a clean image for the new semantic section.
- Do not leave English overlay titles in the final Remotion preview.
- Do not fix white flashes with fades first; remove actual frame gaps between image sequences.
