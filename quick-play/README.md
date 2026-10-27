# 快捷播放

独立的 Chrome / Edge MV3 扩展。PT 详情页的“种子文件”旁显示蓝底白字的 **播 · 快捷播放** 和 **获取mediainfo**。支持直接显示视频文件名、NexusPHP 内联列表和文件列表弹窗。列表按页面顺序选第一个支持的视频，跳过字幕、图片等文件。

PTerClub 使用弹窗展示文件列表：点击扩展按钮会使用当前站点登录状态直接读取文件列表，无需先打开弹窗；手动打开“种子文件”弹窗时，弹窗内也会提供播放与获取信息按钮。关闭弹窗后，本页已识别的文件名仍可使用，刷新页面后重新读取。

MediaInfo 窗口中的“已读取”路径说明在复制后保持不变，复制结果显示在独立、固定高度的提示栏中，避免文本框位置变化。

## 安装（Windows）

1. 在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载本目录 `quick-play`。图标为“播”字。
2. 复制扩展 ID。在 PowerShell 运行以下完整路径命令（无需先切换目录；如移动了项目，请修改脚本路径）：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "D:\PX\code\ChromePlugin\quick-play\native\install.ps1" -ExtensionId 这里替换为扩展ID
   ```

   需要 Python 3.10+。如 `python.exe` 不是实际 Python，可加 `-PythonPath 'C:\Python314\python.exe'`。脚本为当前用户注册 Chrome 和 Edge 本地消息助手，无需管理员权限。若系统阻止脚本执行，可只对这次进程使用 `powershell -NoProfile -ExecutionPolicy Bypass -File .\native\install.ps1 -ExtensionId 你的扩展ID`。
3. 点击工具栏扩展图标，检查程序路径与视频目录。每个目录用一行路径输入框显示，右侧单选“默认”，还可添加或删除路径。默认选中 `\\192.168.12.20\data\WD12T-2\down`。播放和读取媒体信息只搜索选中的目录，找不到时提示切换，不会回退扫描其他目录。修改路径或默认选择后点击“保存配置”。旧配置中的路径和默认选择会保留。
4. MediaInfo CLI 默认路径为 `D:\MediaInfo\MediaInfo.exe`，PotPlayer 默认路径为 `C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe`。自动读取媒体信息需要 [MediaInfo Windows 命令行版](https://mediaarea.net/en/MediaInfo/Download/Windows)，解压到其他目录后修改对应路径即可。
5. 刷新 PT 详情页。点击播放会查找本地文件并把完整路径传给 PotPlayer；点击“获取mediainfo”会显示英文原始字段的完整 MediaInfo 文本，再点击“复制mediainfo”粘贴到发种页面。窗口内“添加 [hide=mediainfo] 标签”选项默认勾选，文本框及复制内容均在原文外包上 `[hide=mediainfo]` 和 `[/hide]`；取消勾选则立即显示并复制原始文本。每次打开窗口时该选项默认勾选。

## 匹配与限制

默认视频目录如下：

| 硬盘 | 网络文件路径 |
| --- | --- |
| sda | `\\192.168.12.20\data\sda` |
| sdc | `\\192.168.12.20\data\sdc` |
| sdd | `\\192.168.12.20\data\sdd` |
| sdf | `\\192.168.12.20\data\sdf` |
| WD12T-1 | `\\192.168.12.20\data\WD12T-1\down` |
| WD12T-2 | `\\192.168.12.20\data\WD12T-2\down` |

- 网页只提供文件名或相对路径。助手只在默认视频目录中查找，依次检查相对路径、“与视频同名的文件夹/视频文件”、最近查找缓存，最后才递归搜索。同一查找层级有多个匹配时会报错并列出路径。不会猜测重命名后的文件，也不会下载种子或媒体。保存配置只检查默认目录是否可访问，其他硬盘可以暂时离线。
- 文件路径缓存在本机保存 10 分钟，播放与读取信息共用，按默认目录隔离；命中时会检查文件是否仍存在且位于该目录中。文件移走后会自动重新查找；新增同名文件会在缓存过期后的完整搜索中重新检查。缓存不可写或被锁定时仍可正常查找，不影响播放。
- 成功读取的 MediaInfo 报告也会缓存 10 分钟，重复点击可直接显示；视频、CLI 程序或输出格式改变时会重新读取。首次读取仍受 NAS 速度影响。输出采用标准英文文本，含可读的文件大小、时长和码率，兼容 PTer 说明要求；不再使用内部字段的 raw/full 输出。
- 请配置具体的下载目录，避免整盘扫描。递归扫描预算 25 秒；单次网络文件系统调用可能超过此时间。NAS 需要事先挂载或登录，助手使用当前 Windows 用户权限。
- 支持 mkv/mp4/avi/mov/m2ts/ts/wmv/flv/webm/mpg/mpeg/m4v。DVD/BD 文件夹、折叠目录树和不同站点的特殊列表布局可能需要适配；无法识别时先手动展开列表。
- 播放按钮只请求启动 PotPlayer，不自动暂停或模拟 Ctrl+F1。“获取mediainfo”直接调用 MediaInfo CLI，内容和 PotPlayer 面板的格式可能不同，不会自动提交发布表单。
- 普通网页不能直接启动本地 exe；通过浏览器官方 Native Messaging 连接本地助手。助手不监听 HTTP 端口。网页脚本不能修改助手配置，只有扩展设置页可以保存目录和程序路径。仅在点击按钮时读取视频信息，信息不上传第三方。
- 扩展在 HTTP/HTTPS 网页中查找“种子文件”表格行，按钮附近只显示文件识别与操作结果。媒体信息保留在当前页面，复制动作需要手动点击。
- 更换扩展 ID 后重新运行安装脚本。不要移动已安装的本目录；移动后重新注册。

## 卸载助手

```powershell
.\native\install.ps1 -ExtensionId 你的扩展ID -Uninstall
```

移除扩展后可删除本目录。卸载脚本仅移除当前用户的两个注册项，保留 `native/config.json` 便于重装。

## 本地验证

```powershell
python -m unittest discover -s quick-play/tests -p "test_*.py"
cd quick-play
npm install
npm test
```

从仓库根目录运行。测试覆盖路径越界、同名冲突、匹配优先级与本地消息协议；真实站点、PotPlayer 播放和 MediaInfo 输出仍需在安装配置后验证。

实现参考：[Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)、[Edge Native Messaging](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/developer-guide/native-messaging)。
