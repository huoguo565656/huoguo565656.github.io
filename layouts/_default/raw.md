{{- /*
  输出文章的原始 Markdown（被输出格式 Raw 使用，产物是 /posts/<slug>/index.md）

  为什么用 os.ReadFile 而不是 .RawContent：
    .RawContent 只给正文、丢掉 frontmatter，站内编辑就改不了标题和标签。
    os.ReadFile 读的是磁盘上的源文件，逐字节原样输出，连 frontmatter 一起带走。

  为什么自己托管而不是让前端去 GitHub 拿：
    raw.githubusercontent.com 在国内不通，jsDelivr 有缓存延迟（刚发布读到旧内容）。
    自己托管是同源、无延迟、无第三方依赖。

  安全说明：输出的就是已经公开渲染过的同一篇文章，只是换成了源码形式，
  不含任何页面上看不到的信息。
*/ -}}
{{- with .File -}}{{- os.ReadFile .Filename -}}{{- end -}}
