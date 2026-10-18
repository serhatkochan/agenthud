param([Parameter(Mandatory=$true)][int]$ProcessId,[long]$WindowHandle=0,[int]$Width=0,[int]$Height=0)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HudWindowCheck {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left,top,right,bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x,y; }
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
 [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr hwnd,int index);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out RECT rect);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd,out RECT rect);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hwnd,ref POINT point);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd,uint flag);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int width,int height,uint flags);
}
'@
$null=[HudWindowCheck]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
$process=Get-Process -Id $ProcessId
$hwnd=if($WindowHandle -ne 0){[IntPtr]::new($WindowHandle)}else{$process.MainWindowHandle}
if($hwnd -eq [IntPtr]::Zero){throw 'Owned window not found'}
$windowPid=[uint32]0
$null=[HudWindowCheck]::GetWindowThreadProcessId($hwnd,[ref]$windowPid)
if($windowPid -ne $ProcessId){throw 'Owned window identity changed'}
$rect=New-Object HudWindowCheck+RECT
$client=New-Object HudWindowCheck+RECT
$null=[HudWindowCheck]::GetWindowRect($hwnd,[ref]$rect)
$null=[HudWindowCheck]::GetClientRect($hwnd,[ref]$client)
if($Width -gt 0 -and $Height -gt 0){
 $outerWidth=$Width+($rect.right-$rect.left)-($client.right-$client.left)
 $outerHeight=$Height+($rect.bottom-$rect.top)-($client.bottom-$client.top)
 if(![HudWindowCheck]::SetWindowPos($hwnd,[IntPtr]::Zero,0,0,$outerWidth,$outerHeight,22)){throw 'Owned window resize failed'}
}
$style=[HudWindowCheck]::GetWindowLongPtrW($hwnd,-20).ToInt64()
$origin=New-Object HudWindowCheck+POINT
$pointer=New-Object HudWindowCheck+POINT
$null=[HudWindowCheck]::ClientToScreen($hwnd,[ref]$origin)
$null=[HudWindowCheck]::GetCursorPos([ref]$pointer)
[ordered]@{windowHandle=$hwnd.ToInt64().ToString();topmost=($style -band 8) -ne 0;transparent=($style -band 32) -ne 0;visible=[HudWindowCheck]::IsWindowVisible($hwnd);minimized=[HudWindowCheck]::IsIconic($hwnd);foreground=[HudWindowCheck]::GetAncestor([HudWindowCheck]::GetForegroundWindow(),3) -eq $hwnd;clientX=$origin.x;clientY=$origin.y;pointerX=$pointer.x;pointerY=$pointer.y}|ConvertTo-Json -Compress
