# vendor/ —— 可选的本地 pdf.js（离线解析用）

这个目录**默认是空的**，Demo 在没有它的情况下也能完整运行：
文献库检索、BM25 索引、引用出处全部走内置模块；
解析 PDF 时若拿不到 pdf.js，会自动降级到内置的经典 PDF 解析器
（只支持未加密、无对象流/xref 流、内容流未压缩或 FlateDecode 的 PDF）。

## 想启用真实的 pdf.js（离线可用）

1. 在**有网络**的机器上下载 pdf.js 的 UMD 构建（与本项目 `scripts/pdftext.js`
   里 `CONFIG.umd` 锁定的版本保持一致）：

   - `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js`
   - `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js`

2. 把两个文件放进本目录，最终路径为：

   ```
   frontend-demo/vendor/pdf.min.js
   frontend-demo/vendor/pdf.worker.min.js
   ```

3. 直接刷新页面即可。`ZY.pdftext.loadEngine()` 的加载顺序是
   **已注入/预载的全局 → 本地 `vendor/pdf.min.js` → CDN UMD → CDN ESM**，
   所以本地文件会被优先使用，**不需要改任何代码，也不需要改 `index.html`**
   （加载器用 `<script>` 动态注入；`workerSrc` 指向 CDN 的 worker，
   若也想完全离线，请在 `scripts/pdftext.js` 的 `CONFIG.workers.umd`
   里把第一项改成 `'vendor/pdf.worker.min.js'` —— 这一行改动由 Lead 决定是否做）。

## 验证是否生效

在浏览器控制台执行：

```js
await ZY.pdftext.loadEngine({ force: true });   // 期望 { ok: true, source: 'local'|'cdn', via: 'global'|'local'|'cdn-umd', message: '...' }
ZY.pdftext.hasEngine();                          // true
```

`message` 会写明实际命中的 URL；`via` 说明走的是哪条路。

> 注意：本仓库的作者环境没有网络，**这条路径没有在真实网络/真实 PDF 上验证过**
> （详见 `docs/RETRIEVAL.md` §1.1 加载顺序、§9「没覆盖」第 1 条）。上面给的 URL 与
> 版本号来自 `scripts/pdftext.js` 里的常量，拷贝时请以代码为准。
