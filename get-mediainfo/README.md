# 获取mediainfo（Get MediaInfo）

独立的 Chrome / Edge MV3 扩展，目录名为 `get-mediainfo`。PT 详情页的“种子文件”旁显示蓝底白字的 **PotPlayer播放视频** 和 **获取mediainfo**。支持直接显示视频文件名、NexusPHP 内联列表和文件列表弹窗。列表按页面顺序选第一个支持的视频，跳过字幕、图片等文件。

PTerClub 使用弹窗展示文件列表：点击扩展按钮会使用当前站点登录状态直接读取文件列表，无需先打开弹窗；手动打开“种子文件”弹窗时，弹窗内也会提供播放与获取信息按钮。关闭弹窗后，本页已识别的文件名仍可使用，刷新页面后重新读取。

MediaInfo 窗口中的“已读取”路径说明在复制后保持不变，复制结果显示在独立、固定高度的提示栏中，避免文本框位置变化。

## 使用说明

点击工具栏中的蓝底白色“M”图标即可打开设置页。**安装与配置教程集中在插件设置页**，包含 Windows 本地助手、Python 下载入口、MediaInfo CLI 官方下载及配置教程。助手未连接时会自动展开安装指南。

程序路径提供可修改的默认值，视频目录由用户自行填写。已有用户保存的目录、默认选择和程序设置会保留在 `native/config.json`，该文件及本地缓存不会随 Git 提交上传。

刷新 PT 详情页后，点击“获取mediainfo”读取标准英文报告，再点“复制mediainfo”粘贴到发布页面。“添加 [hide=mediainfo] 标签”选项默认勾选，文本框和剪贴板内容保持一致；取消勾选则显示并复制原文。

## 匹配与限制

- 网页只提供文件名或相对路径。助手只在默认视频目录中查找，依次检查相对路径、“与视频同名的文件夹/视频文件”、最近查找缓存，最后才递归搜索。同一查找层级有多个匹配时会报错并列出路径。不会猜测重命名后的文件，也不会下载种子或媒体。保存配置只检查默认目录是否可访问，其他硬盘可以暂时离线。
- 文件路径缓存在本机保存 10 分钟，播放与读取信息共用，按默认目录隔离；命中时会检查文件是否仍存在且位于该目录中。文件移走后会自动重新查找；新增同名文件会在缓存过期后的完整搜索中重新检查。缓存不可写或被锁定时仍可正常查找，不影响播放。
- 成功读取的 MediaInfo 报告也会缓存 10 分钟，重复点击可直接显示；视频、CLI 程序或输出格式改变时会重新读取。首次读取仍受 NAS 速度影响。输出采用标准英文文本，含可读的文件大小、时长和码率，兼容 PTer 说明要求；不再使用内部字段的 raw/full 输出。
- 请配置具体的下载目录，避免整盘扫描。递归扫描预算 25 秒；单次网络文件系统调用可能超过此时间。NAS 需要事先挂载或登录，助手使用当前 Windows 用户权限。
- 支持 mkv/mp4/avi/mov/m2ts/ts/wmv/flv/webm/mpg/mpeg/m4v。DVD/BD 文件夹、折叠目录树和不同站点的特殊列表布局可能需要适配；无法识别时先手动展开列表。
- 播放按钮只请求启动 PotPlayer，不自动暂停或模拟 Ctrl+F1。“获取mediainfo”直接调用 MediaInfo CLI，内容和 PotPlayer 面板的格式可能不同，不会自动提交发布表单。
- 普通网页不能直接启动本地 exe；通过浏览器官方 Native Messaging 连接本地助手。助手不监听 HTTP 端口。网页脚本不能修改助手配置，只有扩展设置页可以保存目录和程序路径。仅在点击按钮时读取视频信息，信息不上传第三方。
- 扩展在 HTTP/HTTPS 网页中查找“种子文件”表格行，按钮附近只显示文件识别与操作结果。媒体信息保留在当前页面，复制动作需要手动点击。
- 更换扩展 ID 后重新运行安装脚本。不要移动已安装的本目录；移动后重新注册。

## 本地验证

```powershell
python -m unittest discover -s get-mediainfo/tests -p "test_*.py"
cd get-mediainfo
npm install
npm test
```

从仓库根目录运行。测试覆盖路径越界、同名冲突、匹配优先级与本地消息协议；真实站点、PotPlayer 播放和 MediaInfo 输出仍需在安装配置后验证。

实现参考：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging)。
