# 提价执行表自动同步：一次只读授权

程序已经配置每15分钟检查四个固定Drive文件（每小时07/22/37/52分，GitHub排队可能延迟）。浏览器每60秒读取同步快照。
源文件目前是xlsx，无法直接使用原生Sheets的onEdit触发器。程序只检查修改时间/版本；仅下载变化的工作簿，只解析执行页及必要的当前核验清单，不查询ERP。

## 最少授权步骤（服务账号方式）

1. 在[Google Cloud控制台](https://console.cloud.google.com/)选择或创建项目，启用 **Google Drive API**。
2. 在 **IAM与管理 → 服务账号** 创建一个服务账号；不需要项目管理角色。进入该服务账号 **密钥 → 添加密钥 → 创建新密钥 → JSON**，由本人下载保存。复制其中的 `client_email`。
3. 在原四份报表的“共享”里，给这个 `client_email` 添加 **查看者**，不开放公开链接、不修改任何成员原有权限。
4. 打开[仓库 Actions Secrets](https://github.com/blackblancakeep62-crypto/operations-four-dashboard/settings/secrets/actions)，新建 **Repository secret**：名称 `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`，值为本人下载的完整JSON。不要放在仓库文件、网页或聊天中。
5. 到[同步任务](https://github.com/blackblancakeep62-crypto/operations-four-dashboard/actions/workflows/execution-sync.yml)点击 **Run workflow**。看到绿色成功后，在网页“提价管理”确认四组同步时间和计数。之后每15分钟自动运行。

如账号已有可复用的OAuth授权，可改用 `GOOGLE_DRIVE_OAUTH_JSON`（authorized_user格式，包含client_id/client_secret/refresh_token，并具备drive.readonly授权），无需同时配置两个secret。

## 范围与验收

- 读取A–M执行信息；N–X沿用原表的观察、父单利润、可比对照、最终结论、证据和经营核验字段，用于既有实际验证门槛。A–M不足以证明利润已验证。
- 待提价仍需要原“01”页六项核验、核验人/日期/证据、已核现价与错峰排期；不会把A/B候选直接当成待执行。
- 填写中、空白、缺证据不计实际测试；已完成需要真实起止日和保留/回退结论。已验证利润按父单测试期减基期，不重复扣广告促销，不与理论增量相加；重复ID冲突停止该组更新，同父重叠验证区间不重复归因。
- 故障时保留每组最后有效快照，网页标出最后成功时间；无原始执行行、证据URL或凭证进入静态产物。后台原始缓存用凭证派生密钥加密后存在Actions缓存，不进入仓库。
- `python -m unittest test_execution_sync -q` 使用隔离假记录，覆盖测试中→已完成→验证增量、重复与重叠、缺字段与失败保留。测试不修改真实表格或真实网页的执行状态。
- 当前四表实读均无登记执行行。初始页面标识“自动同步待Google只读授权”。未配置上述secret前，15分钟任务会跳过读取和部署，不能视为自动同步已启用。
- 使用官方GitHub Pages Actions部署；只打包明确列出的静态文件。每日播报、每周提价任务、Google报表人工记录和其他仓库Actions保持不变。

官方参考：[Google Drive只读权限](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[服务账号密钥](https://cloud.google.com/iam/docs/creating-managing-service-account-keys)、[GitHub Pages工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[定时触发限制](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
