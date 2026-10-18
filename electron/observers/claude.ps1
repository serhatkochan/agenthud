$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
try {
  [Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
  $started=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime()
  $text=[Text.StringBuilder]::new()
  $buffer=New-Object char[] 4096
  while(($length=[Console]::In.Read($buffer,0,$buffer.Length)) -gt 0){
    if($text.Length+$length -gt 4194304){return}
    $null=$text.Append($buffer,0,$length)
  }
  $payload=$text.ToString()|ConvertFrom-Json
  $event=$payload.hook_event_name
  if($event -notin @('SessionStart','UserPromptSubmit','PostToolUse','PostToolUseFailure','Notification','Stop','StopFailure','SessionEnd') -or $payload.agent_id){return}
  $id=$payload.session_id
  if($id -isnot [string] -or $id -notmatch '^[\w.:-]{1,160}$'){return}
  $record=@{version=1;event=$event;sessionId=$id;at=$started.ToString('o')}
  if($payload.cwd -is [string] -and $payload.cwd.Length -le 1024 -and [IO.Path]::IsPathRooted($payload.cwd)){$record.cwd=$payload.cwd}
  if($event -eq 'Notification'){
    if($payload.notification_type -notin @('permission_prompt','idle_prompt')){return}
    $record.notificationType=$payload.notification_type
  }
  if($event -eq 'Stop'){$record.background=($payload.background_tasks -is [Array] -and $payload.background_tasks.Count -gt 0)}
  $null=[IO.Directory]::CreateDirectory($AgentHudDirectory)
  $name=$started.ToString('yyyyMMddTHHmmssfffffffZ')+'-'+[Guid]::NewGuid().ToString('N')
  $temporary=[IO.Path]::Combine($AgentHudDirectory,$name+'.tmp')
  [IO.File]::WriteAllText($temporary,($record|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  [IO.File]::Move($temporary,[IO.Path]::Combine($AgentHudDirectory,$name+'.json'))
  if($event -in @('Stop','StopFailure','SessionEnd')){
    foreach($path in [IO.Directory]::EnumerateFiles($AgentHudDirectory,'*.json')){
      if([IO.Path]::GetFileName($path) -match '^\d{8}T\d{13}Z-[a-f0-9]{32}\.json$' -and [IO.File]::GetLastWriteTimeUtc($path) -lt [DateTime]::UtcNow.AddHours(-24)){[IO.File]::Delete($path)}
    }
  }
} catch {} finally {[Console]::Out.Write('{}')}
exit 0
