const {
  Plugin,
  ItemView,
  MarkdownView,
  MarkdownRenderer,
  Notice,
  Setting,
  PluginSettingTab,
  FuzzySuggestModal,
  setIcon,
  requestUrl,
  normalizePath
} = require("obsidian");
const fs = require("fs");
const path = require("path");

const VIEW_TYPE = "wechat-studio-view";
const IMAGE_PATTERN = /!\[[^\]]*\]\(([^)]+)\)|!\[\[([^\]]+)\]\]/g;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const DEFAULT_INLINE_COMPONENT_STYLES = {
  code: "padding:2px 6px;background:#f1f3f5;border-radius:4px;color:#39424e;font-size:.92em;font-family:Consolas,'SF Mono','Courier New',monospace;word-break:break-word;overflow-wrap:break-word;",
  pre: "display:block;margin:1.45em 24px 1.65em 24px;padding:14px 16px;background:#f4f5f6;border:1px solid #d9dde2;border-radius:6px;color:#27313b;font-size:15px;line-height:1.72;white-space:pre-wrap;word-break:break-word;overflow-wrap:break-word;box-sizing:border-box;font-family:Consolas,'SF Mono','Courier New',monospace;",
  preCode: "display:block;margin:0;padding:0;background:transparent;border:none;color:inherit;font-size:inherit;line-height:inherit;font-family:inherit;white-space:inherit;word-break:inherit;overflow-wrap:inherit;",
  table: "width:calc(100% - 48px);margin:1.45em 24px 1.7em 24px;border-collapse:collapse;border-top:1px solid #cfd5dc;background:#fff;color:#30363d;box-sizing:border-box;",
  th: "padding:.68em .78em;background:#f4f5f6;border-bottom:1px solid #cfd5dc;color:#20252b;font-size:15px;line-height:1.6;font-weight:700;text-align:left;vertical-align:top;",
  td: "padding:.66em .78em;border-bottom:1px solid #e5e8eb;color:#30363d;font-size:15px;line-height:1.7;vertical-align:top;",
};

const BUILTIN_STYLE_PRESETS = {
  "minimal-elegant": { label: "留白雅集", css: "", inline: {} },
  "editorial-soft": { label: "柔粉雅文", css: "", inline: {} },
  "linear-tech": { label: "蓝图科技", css: "", inline: {} },
  "practical-guide": { label: "橙色指南", css: "", inline: {} },
  "line-reveal-note": { label: "暖纸手记", css: "", inline: {} },
  "cold-court-editorial": { label: "深蓝锐评", css: "", inline: {} },
  "editorial-panels": { label: "黑金杂志", css: "", inline: {} },
  "official-dashboard": { label: "紫调简报", css: "", inline: {} },
  "laowantong-growth": { label: "老顽童", css: "", inline: {} }
};

function presetIdToLabel(id) {
  return String(id || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const DEFAULT_SETTINGS = {
  selectedStyle: "minimal-elegant",
  appid: "",
  secret: "",
  accessToken: "",
  lastAccessKeyTime: -1,
  isTokenValid: false,
  defaultAuthor: "",
  defaultDigest: "",
  defaultSourceUrl: "",
  defaultOpenComment: false,
  tailMode: "none",
  tailImagePath: "",
  tailCardAvatarPath: "",
  tailCardName: "",
  tailCardBio: "",
  tailCardMeta: "",
  tailCardFooter: "公众号"
};

function stripFrontmatter(text) {
  if (!text) return "";
  return text.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

function getFolderPath(file) {
  if (!file || !file.path) return "";
  const index = file.path.lastIndexOf("/");
  return index === -1 ? "" : file.path.slice(0, index);
}

function scopeCss(css, scope) {
  return css
    .replace(/(^|\})\s*body\s*,/g, `$1 ${scope},`)
    .replace(/(^|\})\s*body\s*\{/g, `$1 ${scope} {`)
    .replace(/(^|\})\s*section\s*,/g, `$1 ${scope} section,`)
    .replace(/(^|\})\s*article\s*,/g, `$1 ${scope} article,`)
    .replace(/(^|\})\s*section\s*\{/g, `$1 ${scope} section {`)
    .replace(/(^|\})\s*article\s*\{/g, `$1 ${scope} article {`)
    .replace(/(^|\}|,)\s*(p|h1|h2|h3|h4|strong|b|em|i|blockquote|ul|ol|li|hr|a|code|pre|img|figure|figcaption|table|th|td)(\s*\{|\s*,)/g, (m, a, sel, tail) => `${a} ${scope} ${sel}${tail}`)
    .replace(new RegExp(`${scope} ${scope}`, "g"), scope);
}

function normalizeContentPath(baseFolder, targetPath) {
  if (!targetPath) return "";
  if (/^https?:\/\//i.test(targetPath) || /^data:/i.test(targetPath)) return targetPath;
  const cleaned = targetPath.split("|")[0].trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("./")) return normalizePath(`${baseFolder}/${cleaned.slice(2)}`);
  return normalizePath(cleaned);
}

function isImageFile(file) {
  return !!file?.extension && IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

class ImageFileSuggestModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("选择 vault 中的图片文件");
  }

  getItems() {
    return this.app.vault.getFiles().filter(isImageFile);
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    if (file?.path && this.onChoose) this.onChoose(file.path);
  }
}

class WeChatStudioSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  addVaultImagePicker(containerEl, name, desc, valueKey, placeholder) {
    const setting = new Setting(containerEl).setName(name).setDesc(desc);
    let inputEl = null;

    setting.addText(text => {
      inputEl = text.inputEl;
      text.setPlaceholder(placeholder)
        .setValue(this.plugin.settings[valueKey] || "")
        .onChange(async value => {
          this.plugin.settings[valueKey] = value.trim();
          await this.plugin.saveSettings();
        });
      text.inputEl.style.width = "320px";
    });

    setting.addButton(button => {
      button.setButtonText("选择").onClick(() => {
        new ImageFileSuggestModal(this.app, async path => {
          this.plugin.settings[valueKey] = path;
          if (inputEl) inputEl.value = path;
          await this.plugin.saveSettings();
        }).open();
      });
    });

    setting.addExtraButton(button => {
      button.setIcon("x").setTooltip("清空").onClick(async () => {
        this.plugin.settings[valueKey] = "";
        if (inputEl) inputEl.value = "";
        await this.plugin.saveSettings();
      });
    });
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("默认风格")
      .setDesc("工作台打开时默认选中的公众号风格")
      .addDropdown(drop => {
        this.plugin.getStylePresetEntries().forEach(([key, item]) => drop.addOption(key, item.label));
        drop.setValue(this.plugin.settings.selectedStyle);
        drop.onChange(async value => {
          this.plugin.settings.selectedStyle = value;
          await this.plugin.saveSettings();
          this.plugin.refreshAllViews();
        });
      });

    new Setting(containerEl)
      .setName("微信公众号 AppID")
      .setDesc("用于获取 access token 和发送公众号草稿")
      .addText(text => {
        text.setPlaceholder("输入 AppID")
          .setValue(this.plugin.settings.appid || "")
          .onChange(async value => {
            this.plugin.settings.appid = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("微信公众号 AppSecret")
      .setDesc("公众号后台配置的 Secret")
      .addText(text => {
        text.setPlaceholder("输入 AppSecret")
          .setValue(this.plugin.settings.secret || "")
          .onChange(async value => {
            this.plugin.settings.secret = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("连接测试")
      .setDesc(this.plugin.settings.isTokenValid ? "当前 token 状态：已连接" : "当前 token 状态：未验证")
      .addButton(button => {
        button.setButtonText("测试连接").setCta().onClick(async () => {
          button.setDisabled(true);
          try {
            await this.plugin.api.refreshAccessToken(true);
            new Notice("公众号连接测试成功");
            this.display();
          } catch (error) {
            console.error(error);
            new Notice(`连接失败：${error?.message || error}`);
          } finally {
            button.setDisabled(false);
          }
        });
      });

    containerEl.createEl("h3", { text: "默认文章信息" });

    new Setting(containerEl)
      .setName("默认作者")
      .setDesc("文章 frontmatter 没有 author 时，发送草稿默认使用这里")
      .addText(text => {
        text.setPlaceholder("例如：康狮富")
          .setValue(this.plugin.settings.defaultAuthor || "")
          .onChange(async value => {
            this.plugin.settings.defaultAuthor = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("默认摘要")
      .setDesc("文章 frontmatter 没有 digest 时，默认使用这里")
      .addTextArea(text => {
        text.setPlaceholder("输入默认摘要")
          .setValue(this.plugin.settings.defaultDigest || "")
          .onChange(async value => {
            this.plugin.settings.defaultDigest = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
      });

    new Setting(containerEl)
      .setName("默认来源链接")
      .setDesc("文章 frontmatter 没有 source_url 时，默认使用这里")
      .addText(text => {
        text.setPlaceholder("https://...")
          .setValue(this.plugin.settings.defaultSourceUrl || "")
          .onChange(async value => {
            this.plugin.settings.defaultSourceUrl = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("默认开启评论")
      .setDesc("文章 frontmatter 没有 open_comment 时，默认使用这里")
      .addToggle(toggle => {
        toggle.setValue(!!this.plugin.settings.defaultOpenComment)
          .onChange(async value => {
            this.plugin.settings.defaultOpenComment = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h3", { text: "结尾默认区块" });

    new Setting(containerEl)
      .setName("结尾模式")
      .setDesc("发送草稿时自动追加到正文结尾")
      .addDropdown(drop => {
        drop.addOption("none", "不追加");
        drop.addOption("image", "只追加默认图片");
        drop.addOption("card", "只追加公众号名片");
        drop.addOption("both", "图片 + 名片");
        drop.setValue(this.plugin.settings.tailMode || "none");
        drop.onChange(async value => {
          this.plugin.settings.tailMode = value;
          await this.plugin.saveSettings();
        });
      });

    this.addVaultImagePicker(
      containerEl,
      "结尾默认图片",
      "从 vault 里选择一张尾图；结尾模式包含图片时使用",
      "tailImagePath",
      "例如：attachments/footer.png"
    );

    this.addVaultImagePicker(
      containerEl,
      "名片头像图片",
      "从 vault 里选择公众号头像；结尾模式包含名片时使用",
      "tailCardAvatarPath",
      "例如：assets/avatar.png"
    );

    new Setting(containerEl)
      .setName("名片公众号名")
      .setDesc("例如：康狮富")
      .addText(text => {
        text.setPlaceholder("输入公众号名")
          .setValue(this.plugin.settings.tailCardName || "")
          .onChange(async value => {
            this.plugin.settings.tailCardName = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("名片简介")
      .setDesc("一到两句介绍，控制在两行内最好")
      .addTextArea(text => {
        text.setPlaceholder("例如：2026年，我决定认真做点事。用AI，把复杂问题讲清楚。")
          .setValue(this.plugin.settings.tailCardBio || "")
          .onChange(async value => {
            this.plugin.settings.tailCardBio = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 3;
      });

    new Setting(containerEl)
      .setName("名片辅助信息")
      .setDesc("例如：175篇原创内容")
      .addText(text => {
        text.setPlaceholder("输入辅助信息")
          .setValue(this.plugin.settings.tailCardMeta || "")
          .onChange(async value => {
            this.plugin.settings.tailCardMeta = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("名片底部标签")
      .setDesc("默认显示“公众号”，你也可以改成“点击上方关注”等")
      .addText(text => {
        text.setPlaceholder("公众号")
          .setValue(this.plugin.settings.tailCardFooter || "公众号")
          .onChange(async value => {
            this.plugin.settings.tailCardFooter = value.trim() || "公众号";
            await this.plugin.saveSettings();
          });
      });
  }
}

class WeChatStudioApi {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.baseWxUrl = "https://api.weixin.qq.com/cgi-bin";
    this.expireDuration = 7200 * 1000;
  }

  getHeaders() {
    return {
      "Accept-Encoding": "gzip, deflate, br",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    };
  }

  async refreshAccessToken(force = false) {
    const { appid, secret, accessToken, lastAccessKeyTime } = this.plugin.settings;
    if (!appid || !secret) throw new Error("请先在 WeChat Studio 设置中配置 AppID 和 AppSecret");
    const stillValid = accessToken && lastAccessKeyTime > 0 && (Date.now() - lastAccessKeyTime) < this.expireDuration;
    if (!force && stillValid) return accessToken;

    const url = `${this.baseWxUrl}/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
    const resp = await requestUrl({ url, method: "GET", headers: this.getHeaders() });
    const token = resp.json?.access_token;
    if (!token) throw new Error(resp.json?.errmsg || "获取 access token 失败");

    this.plugin.settings.accessToken = token;
    this.plugin.settings.lastAccessKeyTime = Date.now();
    this.plugin.settings.isTokenValid = true;
    await this.plugin.saveSettings();
    return token;
  }

  async readBinaryFromPath(baseFolder, targetPath) {
    if (!targetPath) throw new Error("图片路径为空");
    if (/^https?:\/\//i.test(targetPath)) {
      const resp = await requestUrl(targetPath);
      return { bytes: resp.arrayBuffer, contentType: resp.headers?.["content-type"] || "image/png" };
    }

    const nPath = normalizeContentPath(baseFolder, targetPath);
    const file = this.app.vault.getAbstractFileByPath(nPath);
    if (!file || !file.path) throw new Error(`本地图片不存在：${targetPath}`);
    const bytes = await this.app.vault.readBinary(file);
    const ext = (file.extension || "png").toLowerCase();
    const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : "image/png";
    return { bytes, contentType, path: file.path };
  }

  buildMultipartBody(bytes, filename, contentType, fieldName = "media") {
    const boundary = "----WechatStudio" + Math.random().toString(16).slice(2);
    const endBoundary = `\r\n--${boundary}--\r\n`;
    let formDataString = `--${boundary}\r\n`;
    formDataString += `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n`;
    formDataString += `Content-Type: ${contentType}\r\n\r\n`;
    const formDatabuffer = Buffer.from(formDataString, "utf-8");
    const endBoundaryArray = Array.from(Buffer.from(endBoundary, "utf-8"));
    const postArray = Array.from(formDatabuffer).concat(Array.prototype.slice.call(new Uint8Array(bytes)), endBoundaryArray);
    return { boundary, buffer: new Uint8Array(postArray).buffer };
  }

  async uploadImageForArticle(baseFolder, imagePath, fileName = "image") {
    const token = await this.refreshAccessToken();
    const { bytes, contentType } = await this.readBinaryFromPath(baseFolder, imagePath);
    const { boundary, buffer } = this.buildMultipartBody(bytes, `${fileName}.png`, contentType);
    const url = `${this.baseWxUrl}/media/uploadimg?access_token=${token}`;
    const resp = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Accept: "*/*", Connection: "keep-alive" },
      body: buffer
    });
    const uploadedUrl = resp.json?.url;
    if (!uploadedUrl) throw new Error(resp.json?.errmsg || "正文图片上传失败");
    return uploadedUrl;
  }

  async uploadCover(baseFolder, imagePath, fileName = "cover") {
    const token = await this.refreshAccessToken();
    const { bytes, contentType } = await this.readBinaryFromPath(baseFolder, imagePath);
    const { boundary, buffer } = this.buildMultipartBody(bytes, `${fileName}.png`, contentType);
    const url = `${this.baseWxUrl}/material/add_material?access_token=${token}&type=image`;
    const resp = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Accept: "*/*", Connection: "keep-alive" },
      body: buffer
    });
    const mediaId = resp.json?.media_id;
    if (!mediaId) throw new Error(resp.json?.errmsg || "封面上传失败");
    return mediaId;
  }

  async sendDraft(article) {
    const token = await this.refreshAccessToken();
    const url = `${this.baseWxUrl}/draft/add?access_token=${token}`;
    const resp = await requestUrl({
      url,
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ articles: [article] })
    });
    const mediaId = resp.json?.media_id;
    if (!mediaId) throw new Error(resp.json?.errmsg || "公众号草稿发送失败");
    return mediaId;
  }
}

class WeChatStudioView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.api = plugin.api;
    this.activeFile = null;
    this.previewWrap = null;
    this.previewEl = null;
    this.styleSelect = null;
    this.previewRenderToken = 0;
    this.refreshRequestId = 0;
    this.refreshTimer = null;
    this.activeEditorScroller = null;
    this.ignoreNextPreviewScroll = false;
    this.ignoreNextEditorScroll = false;
    this.scrollSyncAttachTimer = null;
    this.editorScrollListener = null;
    this.previewScrollHandler = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "WeChat Studio"; }
  getIcon() { return "panel-right-open"; }

  async onOpen() {
    this.rebuildLayout();
    this.registerEvent(this.app.workspace.on("active-leaf-change", async () => {
      await this.refresh();
      this.scheduleScrollSyncAttach();
    }));
    this.registerEvent(this.app.workspace.on("file-open", async file => {
      if (file && file.extension === "md") this.activeFile = file;
      await this.refresh();
      this.scheduleScrollSyncAttach();
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.scheduleScrollSyncAttach();
    }));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (this.activeFile && file?.path === this.activeFile.path) this.schedulePreviewRefresh();
    }));
    await this.refresh();
    this.scheduleScrollSyncAttach();
    this.app.workspace.onLayoutReady?.(() => this.scheduleScrollSyncAttach());
  }

  onClose() {
    this.clearScrollSync();
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    if (this.scrollSyncAttachTimer) window.clearTimeout(this.scrollSyncAttachTimer);
  }

  rebuildLayout() {
    this.clearScrollSync();
    this.containerEl.empty();
    this.renderLayout();
  }

  createIconAction(container, icon, onClick) {
    const el = container.createDiv({ cls: "wechat-studio-icon-action" });
    setIcon(el, icon);
    el.addEventListener("click", onClick);
    return el;
  }

  renderLayout() {
    const root = this.containerEl.createDiv({ cls: "wechat-studio-view" });
    const toolbar = root.createDiv({ cls: "wechat-studio-toolbar" });
    const toolbarLeft = toolbar.createDiv({ cls: "wechat-studio-toolbar-left" });
    const styleWrap = toolbarLeft.createDiv({ cls: "wechat-studio-style-wrap" });
    styleWrap.createSpan({ cls: "wechat-studio-toolbar-label", text: "风格" });
    this.styleSelect = styleWrap.createEl("select");
    this.plugin.getStylePresetEntries().forEach(([key, item]) => this.styleSelect.createEl("option", { value: key, text: item.label }));
    this.styleSelect.value = this.plugin.settings.selectedStyle;
    this.styleSelect.addEventListener("change", async () => {
      const scrollTop = this.previewWrap ? this.previewWrap.scrollTop : 0;
      this.plugin.settings.selectedStyle = this.styleSelect.value;
      await this.plugin.saveSettings();
      await this.refreshPreview(scrollTop);
    });
    this.createIconAction(toolbarLeft, "settings", async () => await this.openStudioSettings());
    this.createIconAction(toolbarLeft, "refresh-cw", async () => await this.reloadPresetsAndRefresh());
    this.createIconAction(toolbarLeft, "send", async () => await this.sendCurrentDraft());
    this.previewWrap = root.createDiv({ cls: "wechat-studio-preview-wrap" });
    const phone = this.previewWrap.createDiv({ cls: "wechat-studio-phone" });
    this.previewEl = phone.createDiv({ cls: "wechat-studio-preview-inner" });
  }

  notify(text) {
    new Notice(text);
  }

  async openStudioSettings() {
    try {
      if (this.app.setting?.open) this.app.setting.open();
      if (this.app.setting?.openTabById) {
        this.app.setting.openTabById("wechat-studio");
        return;
      }
      this.notify("请到 设置 → 社区插件 → WeChat Studio 中配置 AppID / AppSecret");
    } catch (error) {
      console.error(error);
      this.notify("请到 设置 → 社区插件 → WeChat Studio 中配置 AppID / AppSecret");
    }
  }

  async refresh() {
    const requestId = ++this.refreshRequestId;
    await this.plugin.loadStylePresets();
    if (requestId !== this.refreshRequestId) return;
    const file = this.app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      this.activeFile = file;
    }
    await this.refreshPreview();
    this.scheduleScrollSyncAttach();
  }

  async reloadPresetsAndRefresh() {
    await this.plugin.loadStylePresets();
    this.rebuildLayout();
    if (this.styleSelect) this.styleSelect.value = this.plugin.settings.selectedStyle;
    await this.refreshPreview();
    this.scheduleScrollSyncAttach();
    this.notify("已重新加载风格文件");
  }

  async refreshPreview(restoreScrollTop = null) {
    if (!this.previewEl) return;
    const renderToken = ++this.previewRenderToken;
    const sourceEl = this.getMarkdownScrollElement();
    const sourceScrollTop = sourceEl ? sourceEl.scrollTop : null;
    const scrollTop = restoreScrollTop ?? (this.previewWrap ? this.previewWrap.scrollTop : 0);
    if (!this.activeFile) {
      this.previewEl.replaceChildren();
      this.previewEl.createEl("p", { text: "请先打开一篇 Markdown 文章。" });
      return;
    }
    const nextPreview = document.createElement("div");
    const scopeEl = nextPreview.createDiv({ cls: "wechat-studio-scope" });
    const raw = await this.app.vault.read(this.activeFile);
    const markdown = stripFrontmatter(raw);
    try {
      await MarkdownRenderer.render(this.app, markdown, scopeEl, this.activeFile.path, this);
      this.applyInlineStyles(scopeEl, { preview: true });
    } catch (error) {
      console.error(error);
      scopeEl.createEl("pre", { text: `预览渲染失败：${error?.message || error}` });
    }
    if (renderToken !== this.previewRenderToken) return;
    this.previewEl.replaceChildren(...Array.from(nextPreview.childNodes));
    if (this.previewWrap) requestAnimationFrame(() => {
      const maxPreviewTop = Math.max(0, this.previewWrap.scrollHeight - this.previewWrap.clientHeight);
      this.previewWrap.scrollTop = Math.min(scrollTop, maxPreviewTop);
      if (sourceEl && sourceScrollTop !== null) {
        const maxSourceTop = Math.max(0, sourceEl.scrollHeight - sourceEl.clientHeight);
        sourceEl.scrollTop = Math.min(sourceScrollTop, maxSourceTop);
      }
      this.scheduleScrollSyncAttach();
    });
  }

  schedulePreviewRefresh() {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(async () => {
      this.refreshTimer = null;
      await this.refreshPreview();
    }, 250);
  }

  getActiveMarkdownView() {
    const activeView = this.app.workspace.getActiveViewOfType?.(MarkdownView);
    if (activeView?.file) return activeView;
    const leaf = this.app.workspace.getLeavesOfType("markdown")
      .find(item => item.view?.file?.path === this.activeFile?.path);
    return leaf?.view || null;
  }

  getMarkdownScrollElement() {
    const view = this.getActiveMarkdownView();
    if (!view) return null;
    const candidates = [
      view.editor?.cm?.scrollDOM,
      view.contentEl?.querySelector(".cm-scroller"),
      view.contentEl?.querySelector(".markdown-preview-view"),
      view.contentEl?.querySelector(".view-content")
    ].filter(Boolean);
    return candidates.find(el => el.scrollHeight > el.clientHeight) || candidates[0] || null;
  }

  clearScrollSync() {
    if (this.activeEditorScroller && this.editorScrollListener) {
      this.activeEditorScroller.removeEventListener("scroll", this.editorScrollListener);
    }
    if (this.previewWrap && this.previewScrollHandler) {
      this.previewWrap.removeEventListener("scroll", this.previewScrollHandler);
    }
    this.activeEditorScroller = null;
    this.editorScrollListener = null;
    this.previewScrollHandler = null;
    if (this.scrollSyncAttachTimer) window.clearTimeout(this.scrollSyncAttachTimer);
    this.scrollSyncAttachTimer = null;
    this.ignoreNextPreviewScroll = false;
    this.ignoreNextEditorScroll = false;
  }

  scheduleScrollSyncAttach(attempt = 0) {
    if (this.scrollSyncAttachTimer) window.clearTimeout(this.scrollSyncAttachTimer);
    const delay = attempt === 0 ? 0 : Math.min(1200, 120 * attempt);
    this.scrollSyncAttachTimer = window.setTimeout(() => {
      this.scrollSyncAttachTimer = null;
      const attached = this.attachScrollSync();
      if (!attached && attempt < 12) this.scheduleScrollSyncAttach(attempt + 1);
    }, delay);
  }

  attachScrollSync() {
    const activeView = this.getActiveMarkdownView();
    if (!activeView || !this.previewWrap) return false;
    const editorScroller = activeView.contentEl?.querySelector(".cm-scroller");
    if (!editorScroller) return false;
    if (editorScroller === this.activeEditorScroller && this.editorScrollListener && this.previewScrollHandler) return true;

    this.clearScrollSync();
    this.activeEditorScroller = editorScroller;
    this.ignoreNextPreviewScroll = false;
    this.ignoreNextEditorScroll = false;

    this.editorScrollListener = () => {
      if (!this.containerEl.offsetParent || !this.previewWrap) return;
      if (this.ignoreNextEditorScroll) {
        this.ignoreNextEditorScroll = false;
        return;
      }

      const editorHeight = editorScroller.scrollHeight - editorScroller.clientHeight;
      const previewHeight = this.previewWrap.scrollHeight - this.previewWrap.clientHeight;
      if (editorHeight <= 0 || previewHeight <= 0) return;

      let targetScrollTop;
      if (editorScroller.scrollTop === 0) {
        targetScrollTop = 0;
      } else if (Math.abs(editorScroller.scrollTop - editorHeight) < 2) {
        targetScrollTop = previewHeight;
      } else {
        targetScrollTop = (editorScroller.scrollTop / editorHeight) * previewHeight;
      }

      if (Math.abs(this.previewWrap.scrollTop - targetScrollTop) > 1) {
        this.ignoreNextPreviewScroll = true;
        this.previewWrap.scrollTop = targetScrollTop;
      }
    };

    this.previewScrollHandler = () => {
      if (!this.containerEl.offsetParent || !this.previewWrap) return;
      if (this.ignoreNextPreviewScroll) {
        this.ignoreNextPreviewScroll = false;
        return;
      }

      const editorHeight = editorScroller.scrollHeight - editorScroller.clientHeight;
      const previewHeight = this.previewWrap.scrollHeight - this.previewWrap.clientHeight;
      if (editorHeight <= 0 || previewHeight <= 0) return;

      let targetScrollTop;
      if (this.previewWrap.scrollTop === 0) {
        targetScrollTop = 0;
      } else if (Math.abs(this.previewWrap.scrollTop - previewHeight) < 2) {
        targetScrollTop = editorHeight;
      } else {
        targetScrollTop = (this.previewWrap.scrollTop / previewHeight) * editorHeight;
      }

      if (Math.abs(editorScroller.scrollTop - targetScrollTop) > 1) {
        this.ignoreNextEditorScroll = true;
        editorScroller.scrollTop = targetScrollTop;
      }
    };

    editorScroller.addEventListener("scroll", this.editorScrollListener, { passive: true });
    this.previewWrap.addEventListener("scroll", this.previewScrollHandler, { passive: true });
    return true;
  }

  resolveImageTarget(rawTarget) {
    const target = (rawTarget || "").trim();
    if (!target || /^https?:\/\//i.test(target) || /^data:/i.test(target)) return { target, exists: true, external: true };
    const clean = target.split("|")[0].trim();
    let file = this.app.metadataCache.getFirstLinkpathDest(clean, this.activeFile?.path || "");
    if (!file) {
      const normalized = normalizeContentPath(getFolderPath(this.activeFile), clean);
      const abstract = this.app.vault.getAbstractFileByPath(normalized);
      if (abstract && abstract.path) file = abstract;
    }
    return { target: clean, exists: !!file, external: false, file };
  }

  collectImageIssues(markdown) {
    const issues = [];
    IMAGE_PATTERN.lastIndex = 0;
    let match;
    while ((match = IMAGE_PATTERN.exec(markdown)) !== null) {
      const rawTarget = match[1] || match[2] || "";
      const resolved = this.resolveImageTarget(rawTarget);
      if (!resolved.exists) issues.push(`图片不存在：${resolved.target}`);
    }
    return issues;
  }

  getFirstImageTarget(markdown) {
    IMAGE_PATTERN.lastIndex = 0;
    let match;
    while ((match = IMAGE_PATTERN.exec(markdown)) !== null) {
      const rawTarget = match[1] || match[2] || "";
      const resolved = this.resolveImageTarget(rawTarget);
      if (resolved.exists) return resolved;
    }
    return null;
  }

  async replaceImagesInMarkdown(baseFolder, markdown) {
    let parsed = markdown;
    const replacements = [];
    IMAGE_PATTERN.lastIndex = 0;
    let match;
    let index = 0;
    while ((match = IMAGE_PATTERN.exec(markdown)) !== null) {
      const fullMatch = match[0];
      const rawTarget = match[1] || match[2] || "";
      const resolved = this.resolveImageTarget(rawTarget);
      const sourcePath = resolved.external ? resolved.target : resolved.file?.path;
      if (!sourcePath) continue;
      const uploadedUrl = await this.api.uploadImageForArticle(baseFolder, sourcePath, `article_image_${index}`);
      replacements.push({ fullMatch, uploadedUrl });
      index += 1;
    }
    for (const item of replacements) {
      parsed = parsed.replace(item.fullMatch, `![image](${item.uploadedUrl})`);
    }
    return parsed;
  }

  normalizeCallouts(root) {
    root.querySelectorAll("blockquote > blockquote").forEach(inner => {
      const outer = inner.parentElement;
      if (!outer || outer.tagName !== "BLOCKQUOTE") return;
      outer.classList.add("wechat-studio-callout");
      outer.innerHTML = inner.innerHTML;
    });
  }

  applyPreviewCalloutStyles(root) {
    const preset = this.plugin.getStylePreset(this.plugin.settings.selectedStyle)?.inline;
    if (!preset?.blockquote) return;
    root.querySelectorAll(".wechat-studio-callout").forEach(el => {
      el.style.cssText += preset.callout || preset.blockquote;
    });
  }

  applyPresetComponents(root, preset, options = {}) {
    if (!preset) return;
    this.insertPresetOpening(root, preset);
    this.decorateCodeBlocks(root, preset.codeBlockDecor);
    this.decoratePresetHeadings(root, "h2", preset.h2Decor);
    this.decoratePresetHeadings(root, "h3", preset.h3Decor);
    this.insertPresetEnding(root, preset);
  }

  removeGeneratedCodeControls(root) {
    root.querySelectorAll("button.copy-code-button,.copy-code-button,pre > button").forEach(el => el.remove());
  }

  insertPresetOpening(root, preset) {
    const html = typeof preset.openingMarkHtml === "string" ? preset.openingMarkHtml.trim() : "";
    if (!html) return;
    this.appendPresetHtml(root, html, true);
  }

  insertPresetEnding(root, preset) {
    const html = typeof preset.endingMarkHtml === "string" ? preset.endingMarkHtml.trim() : "";
    if (!html) return;
    this.appendPresetHtml(root, html);
  }

  appendPresetHtml(parent, html, prepend = false) {
    if (typeof html !== "string" || !html.trim()) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    const nodes = Array.from(wrap.childNodes);
    if (nodes.length === 0) return;
    if (prepend) parent.prepend(...nodes);
    else parent.append(...nodes);
  }

  decoratePresetHeadings(root, selector, config) {
    if (!config || typeof config !== "object") return;
    const headings = Array.from(root.querySelectorAll(selector));
    headings.forEach((heading, index) => {
      const text = heading.textContent?.trim();
      if (!text) return;
      const section = document.createElement("section");
      section.style.cssText = config.wrapper || "";
      if (heading.id) section.id = heading.id;

      this.appendPresetHtml(section, config.beforeHtml);

      if (config.kicker) {
        const kicker = document.createElement("section");
        kicker.style.cssText = config.kicker;
        kicker.textContent = config.kickerText || "VALUE";
        section.appendChild(kicker);
      }

      const row = document.createElement("section");
      row.style.cssText = config.row || "";
      if (config.index) {
        const number = document.createElement("span");
        number.style.cssText = config.index;
        number.textContent = String(index + 1).padStart(2, "0");
        row.appendChild(number);
      }
      const title = document.createElement("span");
      title.style.cssText = config.title || "";
      title.textContent = text;
      row.appendChild(title);
      section.appendChild(row);

      this.appendPresetHtml(section, config.afterHtml);

      if (config.rule) {
        const rule = document.createElement("section");
        rule.style.cssText = config.rule;
        section.appendChild(rule);
      }

      heading.replaceWith(section);
    });
  }

  decorateCodeBlocks(root, config) {
    if (!config || typeof config !== "object") return;
    root.querySelectorAll("pre").forEach(pre => {
      if (pre.parentElement?.classList?.contains("wechat-studio-code-window")) return;

      const windowEl = document.createElement("section");
      windowEl.classList.add("wechat-studio-code-window");
      windowEl.style.cssText = config.wrapper || "";

      const chrome = document.createElement("section");
      chrome.style.cssText = config.chrome || "";
      const dots = config.dots || ["#ff6b63", "#ffd166", "#58d26f"];
      dots.forEach(color => {
        const dot = document.createElement("span");
        dot.style.cssText = config.dot || "";
        dot.style.background = color;
        chrome.appendChild(dot);
      });

      pre.style.cssText += config.pre || "";
      pre.replaceWith(windowEl);
      windowEl.appendChild(chrome);
      windowEl.appendChild(pre);
    });
  }

  applyInlineStyles(root, options = {}) {
    const preset = this.plugin.getStylePreset(this.plugin.settings.selectedStyle)?.inline;
    if (!preset) return;
    root.style.cssText = preset.root;
    this.removeGeneratedCodeControls(root);
    const apply = (selector, style) => {
      if (!style) return;
      root.querySelectorAll(selector).forEach(el => { el.style.cssText += style; });
    };
    apply("p", preset.p);
    apply("h1", preset.h1);
    apply("h2", preset.h2);
    apply("h3", preset.h3);
    apply("h4", preset.h4);
    apply("blockquote", preset.blockquote);
    apply("blockquote p", preset.blockquoteP);
    apply("ul", preset.ul);
    apply("ol", preset.ol);
    apply("li", preset.li);
    apply("a", preset.a);
    apply("code", preset.code || DEFAULT_INLINE_COMPONENT_STYLES.code);
    apply("pre", preset.pre || DEFAULT_INLINE_COMPONENT_STYLES.pre);
    apply("pre code", preset.preCode || DEFAULT_INLINE_COMPONENT_STYLES.preCode);
    apply("img", preset.img);
    apply("hr", preset.hr);
    apply("strong", preset.strong);
    apply("b", preset.strong);
    apply("table", preset.table || DEFAULT_INLINE_COMPONENT_STYLES.table);
    apply("th", preset.th || DEFAULT_INLINE_COMPONENT_STYLES.th);
    apply("td", preset.td || DEFAULT_INLINE_COMPONENT_STYLES.td);
    this.normalizeCallouts(root);
    root.querySelectorAll(".wechat-studio-callout").forEach(el => {
      el.style.cssText += preset.callout || preset.blockquote;
    });
    apply("blockquote p", preset.blockquoteP);
    apply("blockquote strong, blockquote b", preset.blockquoteStrong);
    this.applyPresetComponents(root, preset, options);
  }

  async markdownToStyledHtml(filePath, markdown) {
    const temp = document.createElement("div");
    await MarkdownRenderer.render(this.app, markdown, temp, filePath, this);
    this.applyInlineStyles(temp);
    return `<section style="${temp.getAttribute("style") || ""}">${temp.innerHTML}</section>`;
  }

  getTailConfigIssues() {
    const issues = [];
    const { tailMode, tailImagePath, tailCardAvatarPath } = this.plugin.settings;
    if ((tailMode === "image" || tailMode === "both") && tailImagePath) {
      const path = normalizeContentPath("", tailImagePath);
      if (!/^https?:\/\//i.test(path)) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) issues.push(`结尾默认图片不存在：${tailImagePath}`);
      }
    }
    if ((tailMode === "card" || tailMode === "both") && tailCardAvatarPath) {
      const path = normalizeContentPath("", tailCardAvatarPath);
      if (!/^https?:\/\//i.test(path)) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) issues.push(`名片头像图片不存在：${tailCardAvatarPath}`);
      }
    }
    return issues;
  }

  async buildCoverMediaId(baseFolder, frontmatter, markdown, usingFirstImageAsCover) {
    if (frontmatter.thumb_media_id) return frontmatter.thumb_media_id;
    if (frontmatter.banner) return await this.api.uploadCover(baseFolder, frontmatter.banner, `${this.activeFile.basename}_banner`);
    if (frontmatter.banner_path) return await this.api.uploadCover(baseFolder, frontmatter.banner_path, `${this.activeFile.basename}_banner`);
    if (usingFirstImageAsCover) {
      const firstImage = this.getFirstImageTarget(markdown);
      if (firstImage) {
        const sourcePath = firstImage.external ? firstImage.target : firstImage.file?.path;
        if (sourcePath) return await this.api.uploadCover(baseFolder, sourcePath, `${this.activeFile.basename}_banner`);
      }
    }
    throw new Error("无法生成封面 media_id");
  }

  async buildTailHtml(baseFolder) {
    const mode = this.plugin.settings.tailMode || "none";
    if (mode === "none") return "";

    const sections = [];

    if (mode === "image" || mode === "both") {
      const tailImagePath = (this.plugin.settings.tailImagePath || "").trim();
      if (tailImagePath) {
        const tailImageUrl = await this.api.uploadImageForArticle(baseFolder, tailImagePath, "tail_image");
        sections.push(`<section style="margin:32px 0 0 0;text-align:center;"><img src="${tailImageUrl}" style="max-width:100%;border-radius:12px;display:block;margin:0 auto;" /></section>`);
      }
    }

    if (mode === "card" || mode === "both") {
      const name = (this.plugin.settings.tailCardName || "").trim();
      const bio = (this.plugin.settings.tailCardBio || "").trim();
      const meta = (this.plugin.settings.tailCardMeta || "").trim();
      const footer = (this.plugin.settings.tailCardFooter || "公众号").trim() || "公众号";
      const avatarPath = (this.plugin.settings.tailCardAvatarPath || "").trim();
      if (name || bio || meta || avatarPath) {
        let avatarHtml = "";
        if (avatarPath) {
          const avatarUrl = await this.api.uploadImageForArticle(baseFolder, avatarPath, "tail_card_avatar");
          avatarHtml = `<img src="${avatarUrl}" style="width:56px;height:56px;border-radius:50%;display:block;" />`;
        }
        sections.push(`
          <section style="margin:28px 0 0 0;border:1px solid #ececec;border-radius:16px;background:#fbfbfb;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;padding:0;margin:0;">
              <tr>
                ${avatarHtml ? `<td style="width:70px;padding:18px 0 16px 18px;vertical-align:middle;">${avatarHtml}</td>` : ""}
                <td style="padding:18px 8px 16px ${avatarHtml ? "0" : "18px"};vertical-align:middle;">
                  ${name ? `<div style="font-size:20px;line-height:1.35;font-weight:700;color:#1f2328;">${name}</div>` : ""}
                  ${bio ? `<div style="margin-top:6px;font-size:15px;line-height:1.6;color:#5b6573;">${bio}</div>` : ""}
                  ${meta ? `<div style="margin-top:6px;font-size:14px;line-height:1.5;color:#8a94a3;">${meta}</div>` : ""}
                </td>
                <td style="width:24px;padding:18px 18px 16px 0;vertical-align:middle;text-align:right;font-size:20px;color:#a0a7b2;line-height:1;">›</td>
              </tr>
            </table>
            <div style="padding:10px 18px;border-top:1px solid #efefef;font-size:13px;color:#9aa3ae;background:#f7f7f7;">${footer}</div>
          </section>
        `);
      }
    }

    return sections.join("");
  }

  async validateBeforeSend() {
    if (!this.activeFile) return { ok: false, message: "请先打开一篇 Markdown 文件" };
    if (!this.plugin.settings.appid) return { ok: false, message: "未配置微信公众号 AppID。请先点击顶部设置图标，进入 WeChat Studio 配置。" };
    if (!this.plugin.settings.secret) return { ok: false, message: "未配置微信公众号 AppSecret。请先点击顶部设置图标，进入 WeChat Studio 配置。" };

    const cache = this.app.metadataCache.getFileCache(this.activeFile);
    const frontmatter = { ...(cache?.frontmatter || {}) };
    const raw = await this.app.vault.read(this.activeFile);
    const markdown = stripFrontmatter(raw);

    let usingFirstImageAsCover = false;
    if (!(frontmatter.thumb_media_id || frontmatter.banner || frontmatter.banner_path)) {
      const firstImage = this.getFirstImageTarget(markdown);
      if (!firstImage) {
        return { ok: false, message: "缺少封面字段，而且正文里也没有可用的第一张图片。请设置 thumb_media_id / banner / banner_path，或在正文开头放一张图。" };
      }
      usingFirstImageAsCover = true;
      if (firstImage.external) frontmatter.banner = firstImage.target;
      else if (firstImage.file?.path) frontmatter.banner_path = firstImage.file.path;
    }

    const imageIssues = this.collectImageIssues(markdown);
    const tailIssues = this.getTailConfigIssues();
    const issues = [...imageIssues, ...tailIssues];
    if (issues.length > 0) return { ok: false, message: issues.slice(0, 3).join("；") };

    return { ok: true, frontmatter, markdown, usingFirstImageAsCover };
  }

  async sendCurrentDraft() {
    try {
      await this.plugin.loadStylePresets();
      const checked = await this.validateBeforeSend();
      if (!checked.ok) {
        this.notify(checked.message);
        return;
      }
      const { frontmatter, markdown, usingFirstImageAsCover } = checked;
      const baseFolder = getFolderPath(this.activeFile);
      if (usingFirstImageAsCover) this.notify("未设置封面，已默认使用正文第一张图片作为封面");
      this.notify("开始同步：封面 / 正文图片 / 草稿内容");

      const thumbMediaId = await this.buildCoverMediaId(baseFolder, frontmatter, markdown, usingFirstImageAsCover);
      const mdWithUploadedImages = await this.replaceImagesInMarkdown(baseFolder, markdown);
      const html = await this.markdownToStyledHtml(this.activeFile.path, mdWithUploadedImages);
      const tailHtml = await this.buildTailHtml(baseFolder);
      const title = this.activeFile.basename;
      const openComment = typeof frontmatter.open_comment !== "undefined"
        ? (frontmatter.open_comment ? 1 : 0)
        : (this.plugin.settings.defaultOpenComment ? 1 : 0);

      const article = {
        title,
        author: frontmatter.author || this.plugin.settings.defaultAuthor || "",
        digest: frontmatter.digest || this.plugin.settings.defaultDigest || "",
        content: (html + tailHtml).replace(/[\r\n]/g, ""),
        content_source_url: frontmatter.source_url || this.plugin.settings.defaultSourceUrl || "",
        thumb_media_id: thumbMediaId,
        need_open_comment: openComment,
        only_fans_can_comment: 0
      };

      const mediaId = await this.api.sendDraft(article);
      this.notify(`已同步到公众号草稿箱：${mediaId}`);
    } catch (error) {
      console.error(error);
      this.notify(`发送失败：${error?.message || error}`);
    }
  }
}

module.exports = class WeChatStudioPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    await this.loadStylePresets();
    this.api = new WeChatStudioApi(this.app, this);
    this.registerView(VIEW_TYPE, leaf => new WeChatStudioView(leaf, this));
    this.addRibbonIcon("layout-dashboard", "Open WeChat Studio", async () => { await this.activateView(); });
    this.addCommand({ id: "open-wechat-studio", name: "Open WeChat Studio", callback: async () => await this.activateView() });
    this.addSettingTab(new WeChatStudioSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }


  getPresetDir() {
    const adapter = this.app.vault.adapter;
    const basePath = typeof adapter.getBasePath === "function"
      ? adapter.getBasePath()
      : adapter.basePath;
    if (!basePath) throw new Error("无法定位 vault 本地目录，无法加载风格文件");
    return path.join(basePath, this.app.vault.configDir, "plugins", this.manifest.id, "presets");
  }

  async loadStylePresets() {
    const presets = {};
    let presetDir = "";
    try {
      presetDir = this.getPresetDir();
    } catch (error) {
      console.error(error);
      this.stylePresets = { ...BUILTIN_STYLE_PRESETS };
      return;
    }
    if (!fs.existsSync(presetDir)) {
      this.stylePresets = presets;
      return;
    }

    const ids = new Set();
    for (const entry of fs.readdirSync(presetDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".inline.json")) ids.add(entry.name.slice(0, -".inline.json".length));
    }

    for (const id of Array.from(ids).sort((a, b) => a.localeCompare(b))) {
      const cssPath = path.join(presetDir, `${id}.css`);
      const inlinePath = path.join(presetDir, `${id}.inline.json`);
      let css = "";
      let inline = {};
      try {
        if (fs.existsSync(cssPath)) css = fs.readFileSync(cssPath, "utf8");
        if (fs.existsSync(inlinePath)) inline = JSON.parse(fs.readFileSync(inlinePath, "utf8"));
      } catch (error) {
        console.error(`加载风格失败：${id}`, error);
        continue;
      }
      presets[id] = {
        label: BUILTIN_STYLE_PRESETS[id]?.label || presetIdToLabel(id),
        css,
        inline
      };
    }

    this.stylePresets = presets;
    const keys = Object.keys(presets);
    if (keys.length > 0 && !presets[this.settings.selectedStyle]) {
      this.settings.selectedStyle = keys[0];
      await this.saveData(this.settings);
    }
  }

  getStylePresetEntries() {
    return Object.entries(this.stylePresets || BUILTIN_STYLE_PRESETS);
  }

  getStylePreset(id) {
    const presets = this.stylePresets || {};
    return presets[id] || presets[Object.keys(presets)[0]] || null;
  }

  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (this.settings.selectedStyle === "dark-accent") {
      this.settings.selectedStyle = "linear-tech";
      if (this.settings.lastStatus === "已预览 · Dark Accent") this.settings.lastStatus = "已预览 · Linear Tech";
      await this.saveSettings();
    }
    if (typeof this.settings.tailImage === "string" && !this.settings.tailImagePath) {
      this.settings.tailImagePath = this.settings.tailImage;
    }
    delete this.settings.tailImage;
    delete this.settings.tailCardHtml;
  }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.loadStylePresets();
  }

  refreshAllViews() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach(leaf => {
      const view = leaf.view;
      if (view && typeof view.reloadPresetsAndRefresh === "function") view.reloadPresetsAndRefresh();
      else if (view && typeof view.refresh === "function") view.refresh();
    });
  }
};
