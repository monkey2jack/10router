; 升级安装前的清理：杀掉一切 10Router 进程。
;
; 背景：sidecar（Next 服务）与托盘是同一个 10Router.exe（以
; ELECTRON_RUN_AS_NODE 启动的无窗口进程），没有窗口可关；而「升级」路径跑的是
; 【旧版本】的卸载器——它的代码无法修改，旧版卸载器杀不掉这个无窗 sidecar，
; 于是文件锁不释放，报「Failed to uninstall old application files」（v1.3.0
; 升级 1.3.1 实测复现）。customInit 在新安装器的安装段最早执行、先于旧卸载器
; 运行，统一在这里强杀（安装器自己的会话列表此时没有任何 10Router 进程，杀错
; 不可能）。
;
; 为什么必须提权：安装器（oneClick:false 的 assisted installer）本身以普通
; 用户权限运行，taskkill 只能杀同权限或更低权限的进程。而「以管理员身份运行」
; 的 10Router 实例是预期存在的用户状态——MITM/隧道的排障指引会引导用户这样
; 做（"Restart 10Router as administrator"）——非提权的 taskkill 对它 access
; denied，electron-builder 的 CHECK_APP_RUNNING 宏自己也会连杀两轮后放弃并弹
; 「无法关闭」。所以这里用 UAC 提权（-Verb RunAs）从高权限上下文强杀。
;
; v1.3.5 首版的教训（用户实测升级仍弹「无法关闭」）：提权是【静默】的——UAC
; 弹窗没有任何上下文，用户不知道「taskkill.exe 要不要允许」是升级流程的一部分，
; 随手点「否」就原样退回失败，而退出码被丢弃、没有任何解释。本版改为：
;   1. 普通强杀后【先确认是否真有幸存者】——绝大多数机器没有，直接跳过提权，
;      不再凭空弹 UAC；
;   2. 有幸存者时【先解释再提权】：说明这是什么、UAC 该选什么；
;   3. 提权后复查并把结果写进 DetailPrint，用户拒绝 UAC 时明确告知后果。
; 编码是 PowerShell -EncodedCommand 的 UTF-16LE Base64 格式，直连系统
; taskkill.exe 避免 PATH 投毒。

; 幸存者检查用 nsProcess（electron-builder 自带该插件；CHECK_APP_RUNNING 宏
; 也用它，但它的 include 在安装段才展开，customInit 在 .onInit 更早，需自备）。
!ifndef NSPROCESS_INCLUDED_BY_INSTALLER
  !include "nsProcess.nsh"
  !define NSPROCESS_INCLUDED_BY_INSTALLER
!endif

!macro customInit
  DetailPrint "Stopping any running 10Router processes..."
  nsExec::ExecToStack 'taskkill /F /IM 10Router.exe /T'
  Pop $0   ; taskkill 退出码（进程不存在也会报 error，属预期）
  Pop $1   ; 输出（丢弃）
  Sleep 800

  ; 幸存者检查：不用 USERNAME 过滤——我们要看到一切实例，包括提权的。
  ; nsProcess 找到时推 0，找不到推 603。
  ${nsProcess::FindProcess} "10Router.exe" $R9
  ${If} $R9 == 0
    DetailPrint "10Router is still running (likely an elevated instance)."
    ; 解释 + 征求同意后再弹 UAC。MessageBox 把按下的按钮压栈：IDOK=1，IDCANCEL=2。
    ; /SD IDOK：静默安装（/S，自动化测试/无人值守）时自动选「确定」继续——
    ; 否则该框在静默模式下也会显示并永久阻塞。交互安装不受影响（正常弹框）。
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION \
      "检测到仍在运行的 10Router 进程（可能是以管理员身份运行的实例）。$\n$\n点击「确定」后将弹出 UAC 授权窗口——请选择「是」，以便安装器自动关闭它们。$\n选择「取消」则跳过自动关闭，稍后需按提示手动关闭。" \
      /SD IDOK IDOK 0 IDCANCEL 0
    Pop $R8
    ${If} $R8 == 1
      nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand aQBmACAAKABHAGUAdAAtAFAAcgBvAGMAZQBzAHMAIAAtAE4AYQBtAGUAIAAxADAAUgBvAHUAdABlAHIAIAAtAEUAcgByAG8AcgBBAGMAdABpAG8AbgAgAFMAaQBsAGUAbgB0AGwAeQBDAG8AbgB0AGkAbgB1AGUAKQAgAHsAIABTAHQAYQByAHQALQBQAHIAbwBjAGUAcwBzACAALQBGAGkAbABlAFAAYQB0AGgAIAB0AGEAcwBrAGsAaQBsAGwALgBlAHgAZQAgAC0AQQByAGcAdQBtAGUAbgB0AEwAaQBzAHQAIABAACgAJwAvAEYAJwAsACcALwBJAE0AJwAsACcAMQAwAFIAbwB1AHQAZQByAC4AZQB4AGUAJwAsACcALwBUACcAKQAgAC0AVgBlAHIAYgAgAFIAdQBuAEEAcwAgAC0AVwBhAGkAdAAgAC0AVwBpAG4AZABvAHcAUwB0AHkAbABlACAASABpAGQAZABlAG4AIAB9AA=='
      Pop $0   ; 提权脚本退出码（用户拒绝 UAC 属预期，下方复查会给结论）
      Pop $1
      ${nsProcess::FindProcess} "10Router.exe" $R9
      ${If} $R9 == 0
        DetailPrint "10Router processes are STILL running (UAC declined or failed) - the installer will ask you to close them manually."
      ${Else}
        DetailPrint "Leftover elevated 10Router processes closed."
      ${EndIf}
    ${Else}
      DetailPrint "Elevation skipped by user - the installer will ask you to close 10Router manually."
    ${EndIf}
  ${EndIf}

  ; ===== 自带清理：不再调用旧版本卸载器（v1.3.6）=====
  ; electron-builder 的升级路径（installSection.nsh → uninstallOldVersion）会把
  ; 【旧版本发布时冻结的卸载器】拷到 $PLUGINSDIR\old-uninstaller.exe 静默执行：
  ; 其内部的 CHECK_APP_RUNNING 只要非零退出就 Abort，外层循环重试 5 次后弹
  ; 「无法关闭」（appCannotBeClosed），静默路径则表现为
  ; "Failed to uninstall old application files: 2"。v1.3.5 实测：机器上没有任何
  ; 10Router 进程时也会触发（旧卸载器对自身的幽灵检测，无法外部修复）。
  ;
  ; 处理：新安装器自带清理——删除旧版卸载注册表键。uninstallOldVersion 首步
  ; 读该键的 UninstallString，读不到即 ClearErrors+Return 整体跳过
  ; （installUtil.nsh:157-166 模板原生路径），冻结代码根本不会执行。旧程序文件
  ; 由新安装直接覆盖（Electron 应用同构，残留仅装饰性）；用户数据
  ; （%APPDATA%\10router）不在触碰范围；INSTALL_REGISTRY_KEY（InstallLocation
  ; /KeepShortcuts 依赖）保留不动。
  ;
  ; 键名 = UUID.v5(appId "com.techysy.10router", electron-builder NS namespace)，
  ; 确定性派生、跨机器稳定（tests/unit/installer-legacy-cleanup.test.js 有守卫，
  ; appId 变更会使本键失配而测试转红）。
  !define LEGACY_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\d06897b6-43ce-5451-986c-a52486d415bb"
  ReadRegStr $R7 HKCU "${LEGACY_UNINSTALL_KEY}" "UninstallString"
  ${If} $R7 != ""
    DetailPrint "Removing previous version's uninstaller entry (self-managed cleanup)..."
    ReadRegStr $R6 HKCU "${LEGACY_UNINSTALL_KEY}" "InstallLocation"
    DeleteRegKey HKCU "${LEGACY_UNINSTALL_KEY}"
    ; 历史上若装过 perMachine（HKLM），best-effort 清一下；无权限时静默失败
    ClearErrors
    DeleteRegKey HKLM "${LEGACY_UNINSTALL_KEY}"
    ClearErrors
    ${If} $R6 != ""
      ${If} ${FileExists} "$R6\Uninstall 10Router.exe"
        Delete "$R6\Uninstall 10Router.exe"
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !undef LEGACY_UNINSTALL_KEY

  Sleep 1500
!macroend
