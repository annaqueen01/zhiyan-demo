/* ============================================================
   智研 · 通用工具
   零依赖；不使用 ES module（保证 file:// 双击可运行）。
   ============================================================ */
(function (global) {
  'use strict';

  var ZY = global.ZY = global.ZY || {};

  /* ---------- DOM ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /**
   * 创建元素。
   * create('div.card', {id:'x'}, [child, '文本'])
   * 第一个参数支持 tag.class1.class2 简写。
   */
  function create(spec, attrs, children) {
    var parts = String(spec).split('.');
    var el = document.createElement(parts[0] || 'div');
    for (var i = 1; i < parts.length; i++) if (parts[i]) el.classList.add(parts[i]);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') { el.textContent = String(v); return; }
        if (k === 'html') { el.innerHTML = v; return; }
        if (k === 'class') { el.className += (el.className ? ' ' : '') + v; return; }
        if (k === 'style' && typeof v === 'object') { Object.assign(el.style, v); return; }
        if (k.indexOf('on') === 0 && typeof v === 'function') { el.addEventListener(k.slice(2).toLowerCase(), v); return; }
        if (k === 'dataset' && typeof v === 'object') { Object.assign(el.dataset, v); return; }
        if (v === true) { el.setAttribute(k, ''); return; }
        el.setAttribute(k, String(v));
      });
    }
    append(el, children);
    return el;
  }

  function append(parent, children) {
    if (children === null || children === undefined || children === false) return parent;
    if (Array.isArray(children)) {
      children.forEach(function (c) { append(parent, c); });
      return parent;
    }
    if (children instanceof Node) { parent.appendChild(children); return parent; }
    parent.appendChild(document.createTextNode(String(children)));
    return parent;
  }

  function clear(el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; }

  /** SVG 图标（线性风格，1.9 描边，与设计规范一致） */
  var ICONS = {
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
    close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg>',
    play: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    edit: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>',
    pause: '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>',
    download: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5v11M7.5 10L12 14.5 16.5 10M4.5 19.5h15"/></svg>',
    doc: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
    plus: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    plusSm: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    up: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3.8L21 20H3z"/><path d="M12 10v4.4M12 17.4v.4"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.4M12 7.6v.4"/></svg>',
    lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/></svg>',
    trace: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
    refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.6"/><path d="M20 4.5V11h-6.5"/></svg>'
  };

  /* ---------- 时间与数字 ---------- */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function hhmm(d) {
    d = d ? new Date(d) : new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDate(d) {
    d = d ? new Date(d) : new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 三位数分隔，保留指定小数位（统计量展示用） */
  function fmtNum(v, digits) {
    if (v === null || v === undefined || v === '' || isNaN(v)) return '—';
    var n = Number(v);
    var s = Math.abs(n).toFixed(digits === undefined ? 3 : digits);
    var parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + parts.join('.');
  }

  function fmtInt(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtBytes(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** 相对时间：用于进度（“约 20–40 秒”） */
  function fmtDur(ms) {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return '<1 秒';
    var s = Math.round(ms / 1000);
    if (s < 60) return s + ' 秒';
    var m = Math.floor(s / 60);
    var rs = s % 60;
    if (m < 60) return rs ? (m + ' 分 ' + rs + ' 秒') : (m + ' 分钟');
    return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  }

  /* ---------- 统计显著性星号 ---------- */
  function stars(p) {
    if (p === null || p === undefined || isNaN(p)) return '';
    if (p < 0.01) return '***';
    if (p < 0.05) return '**';
    if (p < 0.1) return '*';
    return '';
  }

  /* ---------- 哈希（内容寻址用，非加密） ---------- */
  function hash32(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 7);
  }

  /* ---------- 下载 ---------- */
  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------- 其它 ---------- */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 简单的 Markdown → HTML（仅支持本 Demo 用到的子集） */
  function mdToHtml(md) {
    var lines = String(md).split(/\r?\n/);
    var out = [];
    var inList = false;
    var inCode = false;

    function inline(s) {
      s = escapeHtml(s);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return s;
    }

    lines.forEach(function (line) {
      if (/^```/.test(line)) {
        if (inCode) { out.push('</code></pre>'); inCode = false; }
        else { out.push('<pre class="code-block"><code>'); inCode = true; }
        return;
      }
      if (inCode) { out.push(escapeHtml(line)); return; }

      var m;
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        var lv = Math.min(m[1].length + 1, 4);
        out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>');
        return;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
        return;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (/^\s*$/.test(line)) { out.push(''); return; }
      if (/^---+$/.test(line)) { out.push('<hr>'); return; }
      out.push('<p class="no-indent">' + inline(line) + '</p>');
    });
    if (inList) out.push('</ul>');
    if (inCode) out.push('</code></pre>');
    return out.join('\n');
  }

  ZY.util = {
    $: $, $$: $$, create: create, append: append, clear: clear, ICONS: ICONS,
    hhmm: hhmm, fmtDate: fmtDate, fmtNum: fmtNum, fmtInt: fmtInt,
    fmtBytes: fmtBytes, fmtDur: fmtDur, stars: stars,
    hash32: hash32, uid: uid, downloadText: downloadText,
    clamp: clamp, debounce: debounce, escapeHtml: escapeHtml, mdToHtml: mdToHtml
  };
})(window);
