---
title: CMS 后台
sidebar_position: 99
---

# CMS 后台

这个站点已经接入 Decap CMS，编辑人员可以通过浏览器创建和编辑 Markdown 内容。

## 使用流程

1. 打开 `/admin/`。
2. 使用授权账号登录。
3. 在「文档」或「博客」中新建内容。
4. 点击发布。
5. CMS 会把 Markdown 文件提交到 `dev` 分支。
6. GitHub Actions 自动构建镜像并更新 GitOps manifests 仓库。

发布完成后，用户不需要接触源码、命令行或 Git。

## 上线前配置

后台配置文件位于 `static/admin/config.yml`。当前目标仓库是：

```yaml
repo: plus-jia/gitops-blog
branch: dev
```

如果仓库或默认分支变化，需要同步更新这里。

## 权限说明

Decap CMS 使用 GitHub 后端写入仓库。生产环境需要配置 OAuth 登录或 Git Gateway，并只给编辑人员 CMS 登录权限。

如果希望编辑人员完全不具备 GitHub 仓库写权限，应使用 Git Gateway 或自建 OAuth/API 代理，由后端服务持有仓库写入权限。

推荐权限模型：

- 编辑人员只访问 `/admin/`。
- 仓库写权限交给 CMS 后端或授权应用。
- GitHub Actions 保持现有流程不变。

## 内容目录

- 文档发布到 `docs/`。
- 博客发布到 `blog/`。
- 上传文件保存到 `static/uploads/`，站点访问路径是 `/uploads/...`。
