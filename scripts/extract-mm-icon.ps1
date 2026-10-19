# One-shot: extract the largest icon (256px) from the MiniMax Code client exe
# via SHDefExtractIcon, saved as PNG for the MiniMax provider icon normalization.
param(
    [string]$Exe = "C:\Users\YangYu\AppData\Local\Programs\MiniMax Code\Uninstall MiniMax Code.exe",
    [string]$Out = "$env:TEMP\mm-code-icon-256.png"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class IconExtract {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern int SHDefExtractIconW(string pszIconFile, int iIndex, uint pwFlags, out IntPtr hiconLarge, IntPtr hiconSmall, uint nIconSize);
    [DllImport("user32.dll")]
    public static extern bool DestroyIcon(IntPtr hIcon);
}
'@

$hicon = [IntPtr]::Zero
$hr = [IconExtract]::SHDefExtractIconW($Exe, 0, 0, [ref]$hicon, [IntPtr]::Zero, 256)
if ($hr -ne 0 -or $hicon -eq [IntPtr]::Zero) { Write-Output "extract failed hr=$hr"; exit 1 }
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$bmp = $icon.ToBitmap()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
[IconExtract]::DestroyIcon($hicon) | Out-Null
Write-Output ("extracted " + $bmp.Width + "x" + $bmp.Height + " -> " + $Out)
