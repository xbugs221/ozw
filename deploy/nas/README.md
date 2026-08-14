# VPS 双实例部署

本目录用于在群晖 Container Manager 上运行两个只读 Hermes 历史查看器：

| 实例 | Web 端口 | Hermes 数据 | 工作区 |
|---|---:|---|---|
| `ozw-zzl` | `127.0.0.1:8652` | `hermes-zzl/data` | `homes/zzl/agent_data` |
| `ozw-dmh` | `127.0.0.1:8653` | `hermes-dmh/data` | `homes/Dmh/agent_data` |

`compose.yml` 将 Hermes 数据以只读方式挂载，包含 `state.db`、WAL 文件和所有 profile；工作区使用与 Hermes 容器相同的 `/workspace` 容器路径，保证会话能按项目归属显示。

首次部署时，把本目录复制为 `/volume1/docker/app-data/ozw-deploy`，创建 `.env.zzl` 和 `.env.dmh`，然后执行：

```sh
/volume1/docker/app-data/ozw-deploy/update.sh
```

后续更新仍执行同一命令：它会通过 `alpine/git` 拉取 `main`、构建共享镜像并重建两个容器。数据库和 Hermes 数据均在宿主机目录中，不会因重建丢失。

脚本默认使用 VPS 现有代理访问 GitHub；代理地址变化时可临时覆盖：`GIT_PROXY=http://host:port /volume1/docker/app-data/ozw-deploy/update.sh`。
