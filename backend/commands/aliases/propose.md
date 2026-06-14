创建 oz 变更并生成所有 artifact

- proposal.md（做什么 & 为什么）
- design.md（怎么做）
- tests/（验收测试脚本）
- tasks.md（实现步骤）

理解用户想构建什么 推导出 kebab-case 名称（如 "add user authentication" → `1-add-user-auth`）。注意名称前要加上数字序号，在现有变更数量的基础上累进，数字和kebab-case名称共同构成 name 字段

创建变更目录

```bash
oz create "<name>"
```

在 `docs/changes/<name>/` 创建含 `.openspec.yaml` 的脚手架变更。

```bash
oz status "<name>" --json
```

解析 JSON 获取：

- `applyRequires`：实现前所需的 artifact ID 数组（如 `["tasks"]`）
- `artifacts`：所有 artifact 列表及其状态和依赖关系

使用 **TodoWrite** 追踪 artifact 进度。

按依赖顺序循环处理 artifact（先处理无待定依赖的 artifact）：

a. **对每个 `ready` 状态的 artifact（依赖已满足）**：

- 根据当前 oz change 的 proposal、design、spec、task 文件约定创建 artifact。
- 先读取已有依赖 artifact 获取上下文，再按本仓库 `docs/changes/<change-name>/` 结构写入缺失文件。
- 读取已完成的依赖文件获取上下文
- 使用 `template` 作为结构创建 artifact 文件
- 将 `context` 和 `rules` 作为约束——但不要将其复制到文件中
- 显示简短进度："已创建 <artifact-id>"

b. **继续直到所有 `applyRequires` artifact 完成**

- 创建每个 artifact 后，重新运行 `oz status "<name>" --json`
- 检查 `applyRequires` 中的每个 artifact ID 是否在 artifacts 数组中有 `status: "done"`
- 所有 applyRequires artifact 完成后停止

c. **若某 artifact 需要用户输入**（上下文不明确）：

- 使用 **AskUserQuestion** 澄清
- 然后继续创建

创建验收测试脚本

a. **创建 `tests/spec/` 目录**：在项目的 `tests/spec/` 下存放验收测试，与 `tests/` 中已有的单元测试等隔离

b. **从 specs 的 Scenario 派生测试**：

- 读取所有 `specs/**/*.md`，提取每个 `#### Scenario:` 块
- 每个 scenario 的 WHEN/THEN 对应一个测试用例
- 按 spec 文件分组，生成对应的测试文件

c. **测试脚本规范**：

- 使用项目已有的测试框架（默认用 pytest）
- 测试文件命名：`tests/spec/test_<spec-name>.py`（或对应语言后缀）
- 每个测试函数的 docstring 引用对应的 spec scenario 名称
- **尽量写出反映真实业务需求的测试**，不写实现代码 — 测试此时应该 FAIL（红灯阶段）
- **禁止使用 `pytest.skip`**：无论后端 API 测试还是前端 E2E 测试，都必须写出完整的断言逻辑，测试此时应该 FAIL（红灯阶段），不得用 skip 掩盖
- 参考项目已有的测试文件（如 `tests/test_api_*.py`、`tests/conftest.py`）获取 mock 模式和 fixture 用法

d. **生成 `tests/spec/README.md`**（简短）：

- 列出每个测试文件及其对应的 spec
- 运行命令（如 `pytest tests/spec/` 或 `npm test`）
- 声明：这些测试是验收标准，实现完成后必须全部通过

e. **生成 `test_cmd.sh`**（变更目录下）：

- 一个可直接执行的 shell 脚本，封装测试运行命令
- 用于 oz 的 `test_cmd` 字段
- 退出码 0 = 验收通过，非 0 = 验收失败
- 只运行 `tests/spec/` 下的验收测试，不运行其他测试

**示例**（Python 项目 — 后端 API 测试应写实际逻辑）：

```python
# tests/spec/test_user_auth.py
"""验收测试：用户认证模块
派生自 specs/user-auth/spec.md
"""
from tests.conftest import auth_headers

class TestUserLogin:
    """Scenario: 用户成功登录"""
    def test_valid_credentials_return_token(self, client):
        # WHEN 用户提交正确的用户名和密码
        resp = client.post("/auth/login", json={"username": "alice", "password": "correct"})
        # THEN 系统返回有效的 token
        assert resp.status_code == 200
        assert "token" in resp.json()

    def test_invalid_password_rejected(self, client):
        # WHEN 用户提交错误密码
        resp = client.post("/auth/login", json={"username": "alice", "password": "wrong"})
        # THEN 系统返回 401
        assert resp.status_code == 401
```

**示例**（前端 E2E 测试 — 同样写出完整断言，预期 FAIL）：

```python
# tests/spec/test_dashboard_ui.py
from playwright.sync_api import expect

class TestDashboard:
    def test_admin_sees_stats_panel(self, page):
        """WHEN admin 打开仪表盘 THEN 显示统计面板"""
        page.goto("/dashboard")
        expect(page.locator("[data-testid='stats-panel']")).to_be_visible()
```

```bash
# test_cmd.sh
#!/bin/bash
# 验收测试运行脚本 — 供 oz test_cmd 使用
# 只运行 tests/spec/ 下的验收测试，不干扰其他测试
set -e
cd "$(dirname "$0")/.."
pytest tests/spec/ -v --tb=short
```

创建 tasks.md 每个任务组应在末尾包含验收测试通过条件：

```markdown
## 1. 用户认证模块

- [ ] 1.1 实现登录接口
- [ ] 1.2 实现 JWT token 签发
- [ ] 1.3 验收：`pytest tests/spec/test_user_auth.py` 全部通过
```

**每个功能组的最后一个 task 必须是运行对应测试文件并确认通过。**

```bash
oz status "<name>"
```

**输出**

完成所有 artifact 后，总结：

- 变更名称和位置
- 已创建的 artifact 列表及简短描述
- 验收测试数量和覆盖的 spec 数量
- 就绪状态："所有 artifact 已创建！可以开始实现了。"
- 提示："运行 `oz flow run <change-name>` 开始执行当前 oz change。"

**Artifact 创建指引**

- 按当前 oz change 的 proposal、design、spec、task 约定创建各 artifact
- schema 定义了每个 artifact 的内容，严格遵循
- 创建新 artifact 前读取依赖 artifact 获取上下文
- 使用 `template` 作为输出文件的结构——填写其各节内容
- **重要**：`context` 和 `rules` 是给你的约束，不是文件内容
- 不要将 `<context>`、`<rules>`、`<project_context>` 块复制到 artifact 中
- 这些指导你写什么，但不应出现在输出中

**验收测试指引**

- 测试是验收标准的可执行形式，所有 artifacts 生成后统一供用户审核
- AI 实现代码时不得修改测试文件 — 测试是固定靶标，不是可调节的标准
- 测试脚本必须能独立运行，不依赖实现代码的内部结构（测试公共接口/行为）
- 如果发现测试不合理，应提请人工修改，而不是自行调整
- 测试粒度对齐 spec scenario — 一个 scenario 至少一个测试用例

**约束**

- 创建实现所需的所有 artifact（由 schema 的 `apply.requires` 定义）
- 创建新 artifact 前始终读取依赖 artifact
- 若上下文严重不明确，询问用户——但优先做出合理决策以保持进度
- 若同名变更已存在，询问用户是继续还是创建新的
- 写入后验证每个 artifact 文件存在，再继续下一个
- **全程不阻塞**：一口气生成所有 artifacts（含测试和 tasks.md），最后统一展示供用户审核
- 内容用中文书写
