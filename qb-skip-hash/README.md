# QB 一键辅种

独立的 Chrome / Edge Manifest V3 扩展。右键种子下载链接，选择 **下载至 QB（跳过哈希校验）**；在详情页空白处右键时会查找常见种子下载入口。有多个入口时请直接右键所需下载链接。

右键菜单会显示配置的 QB WebUI 地址，保存新配置后立即更新。详情页任意空白位置均可触发自动识别，例如 PTerClub 的 `<a href="download.php?id=901553" title="下载种子">下载种子</a>`。在 `details.php?id=…` 页面优先匹配当前种子 ID，忽略其他 ID 的推荐种子下载入口；仍有多个无法区分的入口时提示直接右键所需链接。

## 安装与配置

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），启用开发者模式。
2. 选择“加载已解压的扩展程序”，选中本目录 `qb-skip-hash`。
3. 点击扩展图标，填写 QB WebUI 地址，如 `http://192.168.1.10:8080` 或 `https://example.com/qb`。
4. 在同一浏览器配置中打开这个确切地址，提前登录 QB；种子站也需登录。扩展通过浏览器 Cookie 请求，不保存账号、密码或 Cookie。
5. 配置已有文件在 **QB 服务器上** 的保存目录、内容布局及可选分类，保存后测试连接。

例如种子包含 `Movie/Movie.mkv`，QB 上文件位于 `/downloads/Movie/Movie.mkv`，使用原始布局并填写 `/downloads`。文件名、根目录或布局不匹配时，跳过校验不能自动匹配文件。留空保存目录将使用 QB 默认目录。

## 行为与结果

- 由浏览器带登录状态下载 `.torrent`，再以文件上传给 QB。不会把种子站 Cookie 发给 QB，也不依赖 QB 服务器登录种子站。
- 固定发送 `skip_checking=true`、`paused=false`、`stopped=false`，使用手动管理，避免自动分类路径改变保存目录。适用于 qBittorrent 4.3.2+ / 5.x Web API；较旧版本可能不识别内容布局参数。
- 计算种子 info hash，添加前检查重复，添加后查询任务状态。已存在的任务不会被修改或重新启动。
- 图标显示进行中、完成或失败，点击图标查看最近一次结果。任务进入做种队列才显示对应状态；仅添加成功不会声称已做种。
- 来源网页右下角同时显示醒目的操作提示，成功后显示“已下载至 QB 地址”及保存路径、任务状态；重复和失败分别提示。结果保留至手动关闭或页面刷新，样式隔离于网页。页面已跳转或关闭时不会把结果提示写到其他网页。
- 支持常见 `download.php`、`.torrent`、`/torrents/download/…` 链接。不支持只有 JavaScript/POST 的下载按钮、磁力链接、自动通过验证码，种子文件上限 20 MB。
- Cookie 失效需重新登录。不同浏览器配置、隐身模式、代理登录、证书和本地网络权限可能影响访问；测试连接用于检查实际认证结果。
- 请求超时或结果不明确时，先去 QB 检查任务再重试。扩展不会自动重新提交添加请求。

## 权限

需要 HTTP/HTTPS 主机访问权限来请求用户配置的 QB 和任意种子站；`activeTab` / `scripting` 仅在右键时查找当前页面入口；`contextMenus` 提供菜单；`storage` 保存配置和最近状态；`declarativeNetRequestWithHostAccess` 为扩展自身请求设置 Referer/Origin，兼容 QB 的来源检查。临时规则在请求结束后移除，不关闭 QB 的安全设置，不修改普通网页请求。

配置与状态仅保存在本机扩展存储，无第三方服务或遥测。种子文件包含站点 passkey，会作为种子自身内容发送给配置的 QB。

## 本地检查

在本目录运行 `npm test`。测试覆盖种子解析与哈希、登录错误、下载到 HTML、请求参数、重复种子、右键提交及添加后状态查询。模拟测试不能替代真实浏览器 Cookie、种子站及 QB 联调。

API 依据：[qBittorrent 官方 WebUI API](https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0))。
