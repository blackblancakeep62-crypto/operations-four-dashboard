# 提价执行表每日同步：Apps Script 可行性验证中

- 旧服务账号 / OAuth Drive API 后台读取路线已停用，不需要创建服务账号。
- GitHub Actions 改为每天 UTC 02:30（北京时间10:30）触发一次；GitHub队列可能延迟。尚未通过Apps Script授权验证时，定时任务只保留上一有效快照，不读取原表。
- 已用现有Google账号创建独立的Apps Script验证项目，采用默认GCP项目；不需要通过Google Cloud控制台创建账号或配置服务账号。
- 验证函数仅对四个固定原xlsx文件执行读取，创建私有临时转换副本，核对“02｜提价执行与复盘”字段，最后把本脚本创建的副本移入回收站。原文件、填写格式、数据与共享权限均不修改。
- Apps Script仍需要本人完成一次授权：原Drive文件只读、表格只读，以及本脚本所创建文件的管理权限。验证项目尚未部署为公开Web应用，没有GitHub令牌或公开数据接口。
- 只有真实读取与转换通过后，才接入现有Python执行状态和利润计算及Pages发布。授权受阻则停止复杂认证，提供手动同步；不同时维护多套后台读取路线。
- 网页显示最后成功同步时间；当前保留旧快照并明确标注Apps Script授权验证待完成。每日模式超过36小时未有成功数据会提示超时。
- 执行状态及利润规则沿用现有程序；理论利润和实际已验证利润分开；无证据、日期或可比数据不作为已完成收益。
- 每日播报、每周提价任务、ERP及其他经营数据均保持不变。

官方说明：[默认项目可启用高级服务](https://developers.google.com/apps-script/guides/services/advanced)、[Google授权要求](https://developers.google.com/apps-script/guides/services/authorization)。
