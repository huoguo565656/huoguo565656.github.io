/* =========================================================
   博客自定义增强 —— 逻辑
   由 layouts/_partials/extend_footer.html 注入，不改主题文件。

   三块功能：
     1. 导航栏搜索框（标题 + 正文全文检索，懒加载 Fuse 与索引）
     2. 创造模式：输 123456 回车开启 → 右上角「+」→ 换壁纸 / 调亮度磨砂
     3. 站内编辑器：读原始 Markdown，可改、存草稿、导出、跳 GitHub 发布

   设计前提：这是纯静态站，没有后端。
   所以「保存」= 存本机浏览器草稿，「发布」= 去 GitHub 提交后由 Actions 重建。
   ========================================================= */
(function () {
  "use strict";

  /* =========================================================
     0. 基础设施
     ========================================================= */

  /* 配置从 <meta id="blog-config" data-*> 读。
     为什么不用 <script type="application/json">：Go 的 html/template 会对 script
     内容再做一次 JS 转义，JSON 会被二次编码成 "{\"a\":1}"，JSON.parse 拿到字符串。
     data-* 属性没有这个问题。 */
  var CFG = (function () {
    var node = document.getElementById("blog-config");
    if (!node || !node.dataset) return {};
    var d = node.dataset;
    return {
      index: d.index || "index.json",
      fuse: d.fuse || "",
      repo: d.repo || "",
      branch: d.branch || "main",
      srcPath: d.srcPath || "",
      title: d.title || ""
    };
  })();

  var LS = {
    get: function (k, d) {
      try {
        var v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    del: function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  /* 轻提示 */
  var toastEl = null, toastTimer = null;
  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = mk("div");
      toastEl.setAttribute("role", "status");
      toastEl.style.cssText =
        "position:fixed;left:50%;bottom:26px;transform:translate(-50%,10px);z-index:99;" +
        "padding:9px 18px;border-radius:999px;font-size:13.5px;line-height:1.5;" +
        "background:rgba(28,28,30,.92);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);" +
        "opacity:0;transition:opacity .24s ease,transform .24s ease;pointer-events:none;" +
        "max-width:86vw;text-align:center;";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    requestAnimationFrame(function () {
      toastEl.style.opacity = "1";
      toastEl.style.transform = "translate(-50%,0)";
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.style.opacity = "0";
      toastEl.style.transform = "translate(-50%,10px)";
    }, ms || 2200);
  }

  /* =========================================================
     1. 导航栏搜索
     ========================================================= */

  var searchState = {
    lib: null,          // window.Fuse
    index: null,        // Fuse 实例
    data: null,         // 原始索引
    loading: null,
    active: -1,
    items: []
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("加载失败: " + src)); };
      document.head.appendChild(s);
    });
  }

  /* 懒加载：首屏不下 Fuse 也不下索引，等用户真的要搜时才拉。
     另在空闲时预热一次，这样点进去基本是瞬时的。 */
  function ensureSearch() {
    if (searchState.loading) return searchState.loading;
    var jobs = [
      CFG.fuse && !window.Fuse ? loadScript(CFG.fuse) : Promise.resolve(),
      searchState.data
        ? Promise.resolve(searchState.data)
        : fetch(CFG.index, { credentials: "same-origin" }).then(function (r) {
            if (!r.ok) throw new Error("索引 HTTP " + r.status);
            return r.json();
          })
    ];
    searchState.loading = Promise.all(jobs).then(function (res) {
      var FuseCtor = window.Fuse;
      if (!FuseCtor) throw new Error("Fuse 未就绪");
      searchState.data = res[1];
      searchState.lib = FuseCtor;
      searchState.index = new FuseCtor(res[1], {
        includeScore: true,
        ignoreLocation: true,
        threshold: 0.4,
        distance: 200,
        keys: [
          { name: "title", weight: 0.6 },
          { name: "summary", weight: 0.25 },
          { name: "content", weight: 0.15 }
        ]
      });
      return true;
    }).catch(function (err) {
      searchState.loading = null;   // 允许下次重试
      throw err;
    });
    return searchState.loading;
  }

  /* 从正文里截一段含关键词的片段 */
  function snippetOf(item, q) {
    var text = item.content || item.summary || "";
    var summary = item.summary || "";
    if (!q) return (summary || text).slice(0, 120);
    var low = text.toLowerCase(), ql = q.toLowerCase();
    var i = low.indexOf(ql);
    if (i < 0) {
      var is = summary.toLowerCase().indexOf(ql);
      if (is >= 0) return summary.slice(Math.max(0, is - 30), is + 110);
      return (summary || text).slice(0, 120);
    }
    var s = Math.max(0, i - 46);
    return (s > 0 ? "…" : "") + text.slice(s, s + 132).replace(/\s+/g, " ");
  }

  /* 把片段里命中的关键词包上 <mark>（先转义再插入，避免 XSS） */
  function highlight(text, q) {
    var safe = esc(text);
    if (!q) return safe;
    var parts = q.trim().split(/\s+/).filter(function (x) { return x.length >= 1; });
    // 长词优先，避免短词把长词切碎
    parts.sort(function (a, b) { return b.length - a.length; });
    parts.forEach(function (p) {
      var re = new RegExp(esc(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      safe = safe.replace(re, function (m) { return "<mark>" + m + "</mark>"; });
    });
    return safe;
  }

  function buildSearchUI() {
    var menu = document.getElementById("menu");
    if (!menu) return null;

    var li = mk("li", "nav-search");
    var box = mk("div", "nav-search-box");

    box.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"></circle>' +
      '<line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';

    var input = mk("input");
    input.id = "nav-search-input";
    input.type = "search";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "搜索文章");
    input.placeholder = "搜索文章…";

    var kbd = mk("span", "nav-search-kbd", "Ctrl K");
    var clear = mk("button", "nav-search-clear", "×");
    clear.type = "button";
    clear.setAttribute("aria-label", "清空");

    box.appendChild(input);
    box.appendChild(kbd);
    box.appendChild(clear);
    li.appendChild(box);

    var results = mk("ul", "nav-search-results");
    results.setAttribute("aria-label", "搜索结果");
    li.appendChild(results);

    // 放在导航项最前面，视觉上位于「文章 归档 …」左侧
    menu.insertBefore(li, menu.firstChild);

    return { li: li, box: box, input: input, results: results, clear: clear };
  }

  function initSearch() {
    var ui = buildSearchUI();
    if (!ui) return;

    function close() {
      ui.results.classList.remove("is-open");
      ui.results.innerHTML = "";
      searchState.active = -1;
      searchState.items = [];
    }

    function setActive(n) {
      var links = ui.results.querySelectorAll("a");
      if (!links.length) return;
      searchState.active = (n + links.length) % links.length;
      for (var i = 0; i < links.length; i++) {
        links[i].classList.toggle("is-active", i === searchState.active);
      }
      links[searchState.active].scrollIntoView({ block: "nearest" });
    }

    function render(list, q) {
      ui.results.innerHTML = "";
      searchState.items = list;
      searchState.active = -1;

      if (!list.length) {
        var empty = mk("li", "nav-search-empty", "没有匹配的文章");
        ui.results.appendChild(empty);
        ui.results.classList.add("is-open");
        return;
      }

      list.forEach(function (item) {
        var li2 = mk("li");
        var a = mk("a");
        a.href = item.permalink;

        var t = mk("span", "nsr-title");
        t.innerHTML = highlight(item.title || "", q);
        a.appendChild(t);

        var snip = snippetOf(item, q);
        if (snip) {
          var sp = mk("span", "nsr-snippet");
          sp.innerHTML = highlight(snip, q);
          a.appendChild(sp);
        }

        var pathTxt = (item.permalink || "").replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "");
        var meta = mk("span", "nsr-meta", pathTxt);
        a.appendChild(meta);

        li2.appendChild(a);
        ui.results.appendChild(li2);
      });
      ui.results.classList.add("is-open");
    }

    var run = debounce(function () {
      var q = ui.input.value.trim();
      ui.box.classList.toggle("has-value", !!ui.input.value);

      if (!q) { close(); return; }

      ui.results.innerHTML = "";
      ui.results.appendChild(mk("li", "nav-search-empty", "载入索引…"));
      ui.results.classList.add("is-open");

      ensureSearch().then(function () {
        if (ui.input.value.trim() !== q) return;    // 输入已变，丢弃过期结果
        var hits = searchState.index.search(q, { limit: 10 });
        render(hits.map(function (h) { return h.item; }), q);
      }).catch(function () {
        ui.results.innerHTML = "";
        ui.results.appendChild(mk("li", "nav-search-empty", "搜索索引加载失败，稍后再试"));
      });
    }, 130);

    ui.input.addEventListener("input", run);
    ui.input.addEventListener("focus", function () {
      ui.box.classList.toggle("has-value", !!ui.input.value);
      ensureSearch().catch(function () {});       // 预热
      if (ui.input.value.trim()) run();
    });

    ui.clear.addEventListener("click", function () {
      ui.input.value = "";
      ui.box.classList.remove("has-value");
      close();
      ui.input.focus();
    });

    ui.input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(searchState.active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(searchState.active - 1); }
      else if (e.key === "Escape") { close(); ui.input.blur(); }
      // Enter 在创造模式的键盘监听里单独处理
    });

    document.addEventListener("click", function (e) {
      if (!ui.li.contains(e.target)) close();
    });

    // 快捷键：Ctrl/Cmd + K，或 / （不在输入框里时）
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      var inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        ui.input.focus();
        ui.input.select();
        return;
      }
      if (e.key === "/" && !inField) {
        e.preventDefault();
        ui.input.focus();
      }
    });

    // 结果点击后在本页高亮命中的关键词
    ui.results.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest("a") : null;
      if (a && a.href.indexOf(location.origin) === 0) {
        var q = ui.input.value.trim();
        try {
          sessionStorage.setItem("blog:highlight", q);
        } catch (err) {}
      }
    });
  }

  /* 从搜索结果跳进来后，把正文里的关键词高亮一下（一次性） */
  function flashHighlight() {
    var q = null;
    try { q = sessionStorage.getItem("blog:highlight"); } catch (e) {}
    if (!q) return;
    try { sessionStorage.removeItem("blog:highlight"); } catch (e) {}
    var root = document.querySelector(".post-content");
    if (!root || q.length < 2) return;

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.toLowerCase().indexOf(q.toLowerCase()) >= 0) nodes.push(n);
    }
    nodes.slice(0, 3).forEach(function (node) {
      var i = node.nodeValue.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return;
      try {
        var range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + q.length);
        var mark = document.createElement("mark");
        mark.className = "nsr-flash";
        range.surroundContents(mark);
        mark.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (e) { /* 跨节点时 surroundContents 会抛错，忽略 */ }
    });
  }

  /* =========================================================
     2. 创造模式
     ========================================================= */

  var PASSCODE = "123456";
  var keyBuf = "";
  var fab = null, panel = null, panelBuilt = false;

  function creationOn() {
    return document.documentElement.getAttribute("data-creation") === "1";
  }

  function enableCreation(silent) {
    if (creationOn()) { openPanel(); return; }
    document.documentElement.setAttribute("data-creation", "1");
    LS.set("blog:creation", "1");
    mountFab();
    if (!silent) toast("创造模式已开启：点右上角「+」");
    setTimeout(openPanel, 420);      // 等 FAB 出场动画走一段再展开面板
  }

  function disableCreation() {
    document.documentElement.removeAttribute("data-creation");
    LS.del("blog:creation");
    closePanel();
    if (fab) fab.remove();
    fab = null;
    toast("已退出创造模式");
  }

  function mountFab() {
    if (fab) return;
    fab = mk("button", "creation-fab");
    fab.id = "creation-fab";
    fab.type = "button";
    fab.setAttribute("aria-label", "创造模式：换壁纸与编辑");
    fab.title = "换壁纸 / 编辑";
    fab.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line>' +
      '<line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    fab.addEventListener("click", function () {
      if (panel && panel.classList.contains("is-open")) closePanel();
      else openPanel();
    });
    document.body.appendChild(fab);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { fab.classList.add("is-visible"); });
    });
  }

  /* ---- IndexedDB：存壁纸图片本体（localStorage 只有 ~5MB，放不下大图）---- */
  var IDB = (function () {
    var DB = "blog-creative", STORE = "wallpaper", dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        if (!window.indexedDB) return reject(new Error("no indexedDB"));
        var req = indexedDB.open(DB, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, mode);
          var store = t.objectStore(STORE);
          var r = fn(store);
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = function () { reject(r.error); };
        });
      });
    }
    return {
      get: function () { return tx("readonly", function (s) { return s.get("current"); }); },
      put: function (v) { return tx("readwrite", function (s) { return s.put(v, "current"); }); },
      del: function () { return tx("readwrite", function (s) { return s.delete("current"); }); }
    };
  })();

  /* ---- 壁纸与外观设置 ---- */
  var WALL_KEY = "blog:wallpaper";
  var wallObjUrl = null;

  function wallSettings() {
    // ⚠️ 这里必须**保留**读取到的额外字段（kind / url），只补默认值。
    // 早期写法是「重新构造一个只有三个字段的新对象」，结果 saveWallSettings()
    // 把 kind 和 url 一起写没了 —— 表现就是刷新后壁纸消失、只剩亮度设置。
    var s = LS.get(WALL_KEY, null) || {};
    if (typeof s.brightness !== "number") s.brightness = 1;
    if (typeof s.blur !== "number") s.blur = 12;
    s.hasImage = !!s.hasImage;
    return s;
  }

  function saveWallSettings(s) { LS.set(WALL_KEY, s); }

  function applyLook(settings) {
    var root = document.documentElement;
    root.style.setProperty("--wp-brightness", String(settings.brightness));
    root.style.setProperty("--wp-blur", settings.blur + "px");
    root.setAttribute("data-wp-blur", String(Math.round(settings.blur)));
  }

  function applyWallpaperSrc(src) {
    var root = document.documentElement;
    if (!src) {
      root.removeAttribute("data-wallpaper");
      root.style.removeProperty("--wp-image");
      return;
    }
    // url() 里的双引号要转义，否则粘贴的 URL 会破坏 CSS
    var safe = String(src).replace(/"/g, "%22").replace(/[\r\n]/g, "");
    root.style.setProperty("--wp-image", 'url("' + safe + '")');
    root.setAttribute("data-wallpaper", "1");
  }

  function restoreWallpaper() {
    var s = wallSettings();
    applyLook(s);
    if (!s.hasImage) return;

    if (s.kind === "url" && s.url) {
      applyWallpaperSrc(s.url);
      return;
    }
    IDB.get().then(function (rec) {
      if (!rec || !rec.blob) return;
      if (wallObjUrl) URL.revokeObjectURL(wallObjUrl);
      wallObjUrl = URL.createObjectURL(rec.blob);
      applyWallpaperSrc(wallObjUrl);
    }).catch(function () { /* 隐身模式/不支持时静默跳过 */ });
  }

  /* ---- 设置面板 ---- */
  function buildPanel() {
    if (panelBuilt) return;

    panel = mk("aside");
    panel.id = "creation-panel";
    panel.setAttribute("aria-label", "创造模式设置");

    /* 头部 */
    var head = mk("div", "cp-head");
    head.appendChild(mk("h2", null, "创造模式"));
    var closeBtn = mk("button", "cp-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "关闭");
    closeBtn.addEventListener("click", closePanel);
    head.appendChild(closeBtn);

    /* 说明 */
    var hint = mk("p", "cp-hint");
    hint.innerHTML = "设置只保存在<strong>本机浏览器</strong>，不会影响其他访客。";

    /* 壁纸区 */
    var secWall = mk("div", "cp-section");
    secWall.appendChild(mk("h3", null, "壁纸"));

    var thumb = mk("img", "cp-thumb");
    thumb.alt = "壁纸预览";

    var drop = mk("div", "cp-drop");
    drop.innerHTML = "点击选择图片，或把图拖到这里<small>支持 jpg / png / webp / gif</small>";
    var file = mk("input");
    file.type = "file";
    file.accept = "image/*";
    file.style.display = "none";

    drop.addEventListener("click", function () { file.click(); });
    drop.addEventListener("dragover", function (e) {
      e.preventDefault(); drop.classList.add("is-over");
    });
    drop.addEventListener("dragleave", function () { drop.classList.remove("is-over"); });
    drop.addEventListener("drop", function (e) {
      e.preventDefault(); drop.classList.remove("is-over");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) useFile(f);
    });
    file.addEventListener("change", function () {
      if (file.files && file.files[0]) useFile(file.files[0]);
    });

    function useFile(f) {
      if (!/^image\//.test(f.type)) { toast("不是图片文件"); return; }
      if (f.size > 12 * 1024 * 1024) { toast("图片超过 12MB，建议先压缩"); return; }
      IDB.put({ blob: f }).then(function () {
        if (wallObjUrl) URL.revokeObjectURL(wallObjUrl);
        wallObjUrl = URL.createObjectURL(f);
        applyWallpaperSrc(wallObjUrl);
        var s = wallSettings();
        s.hasImage = true; s.kind = "blob";
        delete s.url;              // 从 URL 切到本地图时，清掉旧地址免得恢复时走错分支
        saveWallSettings(s);
        thumb.src = wallObjUrl;
        thumb.classList.add("is-on");
        toast("壁纸已应用");
      }).catch(function () { toast("保存失败（可能是不支持存储的浏览模式）"); });
    }

    var urlRow = mk("div", "cp-url-row");
    var urlInput = mk("input");
    urlInput.type = "text";
    urlInput.placeholder = "或粘贴图片 URL";
    var urlBtn = mk("button", "cp-btn", "应用");
    urlBtn.type = "button";
    urlBtn.addEventListener("click", function () {
      var u = urlInput.value.trim();
      if (!u) return;
      // 只接受 http(s)：data: / javascript: 之类既可能被当成 XSS 载体，
      // 也不是"图片地址"的正常用法，直接在入口拦掉。
      if (!/^https?:\/\//i.test(u)) { toast("请填 http(s) 开头的完整地址"); return; }
      // https 页面加载 http 图片会被浏览器按「混合内容」拦掉，背景会静默失败。
      // 这里提前说清楚，省得用户以为是功能坏了。
      if (location.protocol === "https:" && /^http:\/\//i.test(u)) {
        toast("这个地址是 http，在 https 页面上会被浏览器拦截，换 https 的图床地址", 4200);
        return;
      }
      applyWallpaperSrc(u);
      var s = wallSettings();
      s.hasImage = true; s.kind = "url"; s.url = u;
      saveWallSettings(s);
      IDB.del().catch(function () {});
      thumb.src = u;
      thumb.classList.add("is-on");
      toast("壁纸已应用");
    });
    urlRow.appendChild(urlInput);
    urlRow.appendChild(urlBtn);

    /* 亮度 / 磨砂 */
    var brightRow = mk("div", "cp-row");
    brightRow.appendChild(mk("label", null, "亮度"));
    var bright = mk("input");
    bright.type = "range"; bright.min = "0.3"; bright.max = "1.6"; bright.step = "0.01";
    var brightVal = mk("span", "cp-val");
    brightRow.appendChild(bright);
    brightRow.appendChild(brightVal);

    var blurRow = mk("div", "cp-row");
    blurRow.appendChild(mk("label", null, "磨砂"));
    var blur = mk("input");
    blur.type = "range"; blur.min = "0"; blur.max = "24"; blur.step = "1";
    var blurVal = mk("span", "cp-val");
    blurRow.appendChild(blur);
    blurRow.appendChild(blurVal);

    function syncLookInputs() {
      var s = wallSettings();
      bright.value = String(s.brightness);
      brightVal.textContent = Math.round(s.brightness * 100) + "%";
      blur.value = String(s.blur);
      blurVal.textContent = s.blur + "px";
    }

    bright.addEventListener("input", function () {
      var s = wallSettings();
      s.brightness = parseFloat(bright.value);
      saveWallSettings(s);
      applyLook(s);
      brightVal.textContent = Math.round(s.brightness * 100) + "%";
    });
    blur.addEventListener("input", function () {
      var s = wallSettings();
      s.blur = parseInt(blur.value, 10);
      saveWallSettings(s);
      applyLook(s);
      blurVal.textContent = s.blur + "px";
    });

    var wallBtns = mk("div", "cp-btn-row");
    var resetBtn = mk("button", "cp-btn ghost", "重置外观");
    resetBtn.type = "button";
    resetBtn.addEventListener("click", function () {
      var s = wallSettings();
      s.brightness = 1; s.blur = 12;
      saveWallSettings(s);
      applyLook(s);
      syncLookInputs();
    });
    var removeBtn = mk("button", "cp-btn ghost", "移除壁纸");
    removeBtn.type = "button";
    removeBtn.addEventListener("click", function () {
      applyWallpaperSrc(null);
      IDB.del().catch(function () {});
      var s = wallSettings();
      s.hasImage = false; delete s.url; delete s.kind;
      saveWallSettings(s);
      thumb.classList.remove("is-on");
      thumb.removeAttribute("src");
      urlInput.value = "";
      toast("壁纸已移除");
    });
    wallBtns.appendChild(resetBtn);
    wallBtns.appendChild(removeBtn);

    var wallNote = mk("p", "cp-note");
    wallNote.textContent = "亮度只作用于背景图；磨砂会同时影响导航栏与正文卡片，调低后文字会更清晰地压在图上。";

    secWall.appendChild(thumb);
    secWall.appendChild(drop);
    secWall.appendChild(file);
    secWall.appendChild(urlRow);
    secWall.appendChild(brightRow);
    secWall.appendChild(blurRow);
    secWall.appendChild(wallBtns);
    secWall.appendChild(wallNote);

    /* 文章区（仅文章页） */
    var secPost = mk("div", "cp-section");
    secPost.appendChild(mk("h3", null, "文章"));
    if (CFG.srcPath) {
      var editBtn = mk("button", "cp-btn primary block", "✎ 编辑本文");
      editBtn.type = "button";
      editBtn.addEventListener("click", function () {
        closePanel();
        openEditor();
      });
      secPost.appendChild(editBtn);
      var draftNote = mk("p", "cp-note");
      draftNote.id = "cp-draft-note";
      secPost.appendChild(draftNote);
    } else {
      secPost.appendChild(mk("p", "cp-note", "当前不是文章页，没有可编辑的内容。"));
    }

    /* 退出 */
    var secExit = mk("div", "cp-section");
    var exitBtn = mk("button", "cp-btn ghost block", "退出创造模式");
    exitBtn.type = "button";
    exitBtn.addEventListener("click", disableCreation);
    secExit.appendChild(exitBtn);

    panel.appendChild(head);
    panel.appendChild(hint);
    panel.appendChild(secWall);
    panel.appendChild(secPost);
    panel.appendChild(secExit);

    document.body.appendChild(panel);
    panelBuilt = true;
    panel._syncLook = syncLookInputs;

    // ESC 关闭面板
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel.classList.contains("is-open")) closePanel();
    });
  }

  function openPanel() {
    buildPanel();
    if (panel._syncLook) panel._syncLook();
    // 面板打开时把当前壁纸显示成缩略图
    var s = wallSettings();
    var thumb = panel.querySelector(".cp-thumb");
    if (s.hasImage) {
      if (s.kind === "url" && s.url) {
        thumb.src = s.url; thumb.classList.add("is-on");
      } else if (wallObjUrl) {
        thumb.src = wallObjUrl; thumb.classList.add("is-on");
      }
    }
    var note = document.getElementById("cp-draft-note");
    if (note && CFG.srcPath) {
      var d = LS.get("blog:draft:" + CFG.srcPath, null);
      note.textContent = d
        ? "本机有一份未发布的草稿（点「编辑本文」继续改）。"
        : "编辑内容存在本机浏览器，发布需在 GitHub 提交。";
    }
    panel.classList.add("is-open");
    if (fab) fab.classList.add("is-open");
  }

  function closePanel() {
    if (panel) panel.classList.remove("is-open");
    if (fab) fab.classList.remove("is-open");
  }

  /* ---- 键盘彩蛋：输入 123456 后回车 ---- */
  function initPasscode() {
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      var inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

      if (e.key === "Enter") {
        // 情形一：在搜索框里输入口令后回车（不触发搜索）
        if (inField && t.id === "nav-search-input" && t.value.trim() === PASSCODE) {
          e.preventDefault();
          t.value = "";
          t.blur();
          var box = t.closest(".nav-search-box");
          if (box) box.classList.remove("has-value");
          var res = document.getElementById("menu");
          var list = res && res.querySelector(".nav-search-results");
          if (list) { list.classList.remove("is-open"); list.innerHTML = ""; }
          enableCreation();
          return;
        }
        // 情形二：在页面任意位置盲打口令后回车
        if (!inField && keyBuf === PASSCODE) {
          e.preventDefault();
          keyBuf = "";
          enableCreation();
          return;
        }
        keyBuf = "";
        return;
      }

      if (inField) return;                        // 输入框里打字不参与
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.key || e.key.length !== 1) return;
      keyBuf = (keyBuf + e.key).slice(-PASSCODE.length);
    });
  }

  /* =========================================================
     3. 站内编辑器
     ========================================================= */

  var editorEl = null;
  var editorOrig = "";
  var editorDirty = false;

  function draftKey() { return "blog:draft:" + (CFG.srcPath || "unknown"); }

  function openEditor() {
    if (!CFG.srcPath) { toast("当前页面没有对应的源文件"); return; }
    if (editorEl) { editorEl.classList.add("is-open"); return; }

    editorEl = mk("div");
    editorEl.id = "blog-editor";

    /* 顶栏 */
    var bar = mk("div", "be-bar");
    var title = mk("span", "be-title", CFG.srcPath + " · 原始 Markdown");
    var status = mk("span", "be-status", "");

    var btnSave = mk("button", "cp-btn", "保存草稿");
    var btnCopy = mk("button", "cp-btn", "复制");
    var btnDl = mk("button", "cp-btn", "下载 .md");
    var btnGh = mk("button", "cp-btn primary", "去 GitHub 发布");
    var btnRevert = mk("button", "cp-btn ghost", "还原原文");
    var btnClose = mk("button", "cp-btn ghost", "关闭");

    [btnSave, btnCopy, btnDl, btnGh, btnRevert, btnClose].forEach(function (b) { b.type = "button"; });

    bar.appendChild(title);
    bar.appendChild(status);
    bar.appendChild(btnSave);
    bar.appendChild(btnCopy);
    bar.appendChild(btnDl);
    bar.appendChild(btnGh);
    bar.appendChild(btnRevert);
    bar.appendChild(btnClose);

    /* 主体 */
    var bodyWrap = mk("div", "be-body");
    var ta = mk("textarea");
    ta.id = "be-textarea";
    ta.spellcheck = false;
    ta.setAttribute("aria-label", "文章 Markdown 源码");
    var orig = mk("div", "be-orig");
    orig.id = "be-orig";
    bodyWrap.appendChild(ta);
    bodyWrap.appendChild(orig);

    editorEl.appendChild(bar);
    editorEl.appendChild(bodyWrap);
    document.body.appendChild(editorEl);
    document.documentElement.setAttribute("data-editing", "1");

    function setStatus(msg, kind) {
      status.textContent = msg || "";
      status.className = "be-status" + (kind ? " is-" + kind : "");
    }

    /* 载入：优先草稿，否则拉原始 Markdown（同源，/posts/<slug>/index.md） */
    setStatus("载入中…");
    fetch("./index.md", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      })
      .then(function (text) {
        editorOrig = text;
        var draft = LS.get(draftKey(), null);
        if (draft && draft.content) {
          ta.value = draft.content;
          setStatus("载入了本机草稿（" + (draft.at || "").slice(0, 16).replace("T", " ") + "）", "warn");
        } else {
          ta.value = text;
          setStatus("");
        }
        orig.textContent = text;
        editorEl.classList.add("is-open");
      })
      .catch(function (e) {
        setStatus("读不到原始 Markdown（" + e.message + "）", "warn");
        ta.value = "";
        editorEl.classList.add("is-open");
      });

    ta.addEventListener("input", function () {
      editorDirty = ta.value !== editorOrig;
      setStatus(editorDirty ? "有未保存的改动" : "", editorDirty ? "warn" : "");
    });

    /* Ctrl/Cmd + S 保存草稿 */
    ta.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        doSave();
      }
      if (e.key === "Tab") {                       // Tab 缩进而不是跳焦点
        e.preventDefault();
        var s = ta.selectionStart, en = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + 2;
      }
    });

    function doSave() {
      LS.set(draftKey(), { content: ta.value, at: new Date().toISOString() });
      editorDirty = ta.value !== editorOrig;
      setStatus("草稿已存到本机浏览器（" + new Date().toTimeString().slice(0, 5) + "）", "ok");
      toast("草稿已保存");
    }

    btnSave.addEventListener("click", doSave);

    btnCopy.addEventListener("click", function () {
      var text = ta.value;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
          .then(function () { toast("已复制到剪贴板"); })
          .catch(function () { fallbackCopy(text); });
      } else {
        fallbackCopy(text);
      }
    });

    function fallbackCopy(text) {
      var tmp = mk("textarea");
      tmp.value = text;
      tmp.style.cssText = "position:fixed;left:-9999px;top:0;";
      document.body.appendChild(tmp);
      tmp.select();
      try {
        document.execCommand("copy");
        toast("已复制到剪贴板");
      } catch (e) {
        toast("复制失败，请手动全选复制");
      }
      tmp.remove();
    }

    btnDl.addEventListener("click", function () {
      var name = (CFG.srcPath || "post.md").split("/").pop();
      var blob = new Blob([ta.value], { type: "text/markdown;charset=utf-8" });
      var a = mk("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      toast("已下载 " + name);
    });

    btnGh.addEventListener("click", function () {
      if (editorDirty) doSave();
      var url = "https://github.com/" + CFG.repo + "/edit/" + CFG.branch + "/content/" + CFG.srcPath;
      window.open(url, "_blank", "noopener");
      toast("已在新标签页打开 GitHub 编辑器");
    });

    btnRevert.addEventListener("click", function () {
      if (!confirm("丢弃本机草稿并还原为线上的原文？")) return;
      LS.del(draftKey());
      ta.value = editorOrig;
      editorDirty = false;
      setStatus("已还原为原文", "ok");
    });

    btnClose.addEventListener("click", closeEditor);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && editorEl && editorEl.classList.contains("is-open")) closeEditor();
    });
  }

  function closeEditor() {
    if (!editorEl) return;
    editorEl.classList.remove("is-open");
    document.documentElement.removeAttribute("data-editing");
  }

  /* 文章页里放一个显眼的「编辑本文」入口（只在创造模式下显示） */
  function mountInlineEditEntry() {
    if (!CFG.srcPath) return;
    var host = document.querySelector(".post-content");
    if (!host) return;

    var wrap = mk("div", "be-entry");
    var btn = mk("button", "cp-btn primary");
    btn.type = "button";
    btn.textContent = "✎ 编辑本文（创造模式）";
    btn.addEventListener("click", openEditor);
    wrap.appendChild(btn);
    host.parentNode.insertBefore(wrap, host.nextSibling);
  }

  /* =========================================================
     4. 启动
     ========================================================= */

  function boot() {
    initSearch();
    initPasscode();

    if (CFG.srcPath) {
      document.documentElement.setAttribute("data-post", "1");
      mountInlineEditEntry();
    }

    restoreWallpaper();

    if (LS.get("blog:creation", null) === "1") {
      document.documentElement.setAttribute("data-creation", "1");
      mountFab();
    }

    flashHighlight();

    // 空闲时预热搜索资源，别抢首屏带宽
    var warm = function () { ensureSearch().catch(function () {}); };
    if (window.requestIdleCallback) setTimeout(function () { requestIdleCallback(warm); }, 1200);
    else setTimeout(warm, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
