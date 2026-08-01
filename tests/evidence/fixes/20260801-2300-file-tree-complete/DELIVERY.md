# 文件 Tab 完整展示

## 这次给用户带来了什么

文件 Tab 现在会展示项目目录中所有可读取的文件和目录，包括隐藏目录、构建目录、依赖目录以及版本控制目录。原有的默认折叠方式保持不变，进入项目时只显示当前层级，点击目录后再查看其中内容。

## 如何验收

1. 在项目根目录准备一个隐藏文件，以及 `.git`、`node_modules`、`dist`、`build` 目录。
2. 打开项目的文件 Tab。
3. 确认这些文件和目录都出现在当前层级。
4. 点击任一目录，确认其内容可以继续展开查看。

## 修复前后对比

同一组目录内容的对比结果：

- [修复前对比](/home/zzl/projects/ozw/tests/evidence/fixes/20260801-2300-file-tree-complete/before/file-tree-list.txt)
- [修复后对比](/home/zzl/projects/ozw/tests/evidence/fixes/20260801-2300-file-tree-complete/after/file-tree-list.txt)

## 可直接查看的证据

- [修复前文件 Tab 列表](/home/zzl/projects/ozw/tests/evidence/fixes/20260801-2300-file-tree-complete/before/file-tree-list.txt)
- [修复后文件 Tab 列表](/home/zzl/projects/ozw/tests/evidence/fixes/20260801-2300-file-tree-complete/after/file-tree-list.txt)

## 已知限制

只展示当前用户有权限读取的磁盘内容；无权限目录仍可能无法展开。
