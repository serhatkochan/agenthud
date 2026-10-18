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
  if($event -notin @('sessionStart','afterAgentThought','afterAgentResponse','stop','sessionEnd')){return}
  $id=$payload.conversation_id
  if(!$id){$id=$payload.session_id}
  if($id -isnot [string] -or $id -notmatch '^[\w.:-]{1,160}$'){return}
  $generation=$payload.generation_id
  if(!$generation){$generation=''}
  if($generation -isnot [string] -or ($generation -ne '' -and $generation -notmatch '^[\w.:-]{1,160}$')){return}
  if($event -notin @('sessionStart','sessionEnd') -and !$generation){return}
  $roots=@()
  if($payload.workspace_roots -is [Array]){$roots=@($payload.workspace_roots|Where-Object{$_ -is [string] -and $_.Length -le 1024 -and [IO.Path]::IsPathRooted($_)}|Select-Object -First 8)}
  $record=@{version=1;event=$event;conversationId=$id;generationId=$generation;roots=$roots;at=$started.ToString('o')}
  if($event -eq 'stop' -and $payload.status -in @('completed','aborted','error')){$record.status=$payload.status}
  if($event -eq 'sessionEnd' -and $payload.reason -in @('completed','aborted','error','window_close','user_close')){$record.reason=$payload.reason}
  $null=[IO.Directory]::CreateDirectory($AgentHudDirectory)
  $name=$started.ToString('yyyyMMddTHHmmssfffffffZ')+'-'+[Guid]::NewGuid().ToString('N')
  $temporary=[IO.Path]::Combine($AgentHudDirectory,$name+'.tmp')
  [IO.File]::WriteAllText($temporary,($record|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  [IO.File]::Move($temporary,[IO.Path]::Combine($AgentHudDirectory,$name+'.json'))
  if($event -in @('stop','sessionEnd')){
    foreach($path in [IO.Directory]::EnumerateFiles($AgentHudDirectory,'*.json')){
      if([IO.Path]::GetFileName($path) -match '^\d{8}T\d{13}Z-[a-f0-9]{32}\.json$' -and [IO.File]::GetLastWriteTimeUtc($path) -lt [DateTime]::UtcNow.AddHours(-24)){[IO.File]::Delete($path)}
    }
  }
} catch {} finally {[Console]::Out.Write('{}')}
exit 0
