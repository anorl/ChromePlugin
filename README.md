# ChromePlugin

个人使用的 Chrome / Edge 浏览器扩展合集。**各插件相互独立，可单独安装、使用和更新，不依赖本仓库中的其他插件。** 按需下载或保留对应插件目录即可；每个插件自身所需的软件和配置在下面分别说明。

## 获取mediainfo（Get MediaInfo）

目录：[get-mediainfo](get-mediainfo/) · [详细说明](get-mediainfo/README.md)

在 PT 种子详情页增加“播放视频”和“获取mediainfo”按钮。可读取并复制 MediaInfo，也可调用本地 PotPlayer 播放视频，支持默认视频目录、查找缓存及 `[hide=mediainfo]` 标签。

- **安装**：在 Chrome / Edge 扩展管理页开启开发者模式，加载 `get-mediainfo` 目录，再按详细说明安装本插件的 Windows 本地助手。
- **配置**：需要 Python 3.10+ 和 PotPlayer；获取媒体信息还需 MediaInfo CLI。填写程序路径、本机或 NAS 视频目录，并选中默认目录。
- **使用**：刷新种子详情页，点击播放或获取信息按钮。修改目录后保存配置即可。

## QB 一键辅种

目录：[qb-skip-hash](qb-skip-hash/) · [详细说明](qb-skip-hash/README.md)

右键种子下载链接或详情页，将种子添加到 qBittorrent 并跳过哈希校验。支持保存目录、内容布局和分类设置，包含重复任务检查及页面结果提示。

- **安装**：在 Chrome / Edge 扩展管理页开启开发者模式，加载 `qb-skip-hash` 目录。
- **配置**：在扩展中填写 QB WebUI 地址和 QB 服务器上的保存目录；在同一浏览器配置中提前登录该 QB 地址及种子站。
- **使用**：右键种子下载链接，选择“下载至 QB（跳过哈希校验）”。已有数据的文件名和目录布局需要与种子匹配。

## PTerClub 图片上传助手

目录：[pter-image-uploader](pter-image-uploader/) · [详细说明](pter-image-uploader/README.md)

右键网页图片，将原图上传到 PTerClub 图床并复制 `[img]图片地址[/img]` BBCode。支持最近上传记录、图片预览和重新复制。

- **安装**：在 Chrome / Edge 扩展管理页开启开发者模式，加载 `pter-image-uploader` 目录。
- **配置**：在安装本插件的同一浏览器配置中登录 `https://s3.pterclub.net/`。
- **使用**：右键网页图片，选择上传到 PTerClub 图床并复制 BBCode；结果会在原页面提示，也可点击扩展图标查看。

## PT 种子认领助手

目录：[PTClaimTorrents](PTClaimTorrents/) · [详细说明](PTClaimTorrents/README.md)

在 PTerClub 用户详情页的“当前做种”列表中，按顺序认领种子并处理确认弹窗。支持操作间隔设置、进度记录和停止操作。

- **安装**：在 Chrome / Edge 扩展管理页开启开发者模式，加载 `PTClaimTorrents` 目录。
- **配置**：登录 PTerClub，打开用户详情页并定位到“当前做种”，首次加载插件后刷新页面。
- **使用**：点击扩展图标，确认操作间隔后开始认领；页面刷新后会继续处理，可随时停止。

## 自动打开并感谢

目录：[auto-thanks](auto-thanks/)

按配置的页码范围遍历种子列表，依次打开详情页、点击“说谢谢”并关闭详情页。提供进度统计、日志和停止按钮。

- **安装**：在 Chrome / Edge 扩展管理页开启开发者模式，加载 `auto-thanks` 目录。
- **配置**：登录目标站点，打开种子列表页，在扩展中填写列表页模板（如 `https://example.com/torrents.php?page={page}`）及起止页码。
- **使用**：保存配置后点击“开始”，通过扩展面板查看进度或停止。当前逻辑面向 `details.php?id=…` 形式的详情页和“说谢谢”按钮。

免责申明：请遵循站点管理规则使用插件，如被封号等处罚本人概不负责！

