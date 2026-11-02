# NovaCalendar 업데이트 배포용 latest.json 만들기
#
# 사용법(PowerShell):
#   .\make-latest.ps1 -Setup "\\서버\공유\NovaCalendar\NovaCalendar-Setup-1.12.0.exe" -Notes "완료 체크 개선"
#
# 설치 파일과 같은 폴더에 latest.json 을 만든다. 각 PC의 설정 → 업데이트 위치에는 그 폴더 경로(또는 https 주소)를 넣는다.
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [string]$Notes = ""
)
$ErrorActionPreference = "Stop"
$f = Get-Item -LiteralPath $Setup
if ($f.Name -notmatch '(\d+\.\d+\.\d+)') { throw "파일 이름에서 버전(예: 1.12.0)을 찾을 수 없습니다: $($f.Name)" }
$version = $Matches[1]
$hash = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.ToLower()
$json = [ordered]@{ version = $version; file = $f.Name; sha256 = $hash; notes = $Notes } | ConvertTo-Json
$out = Join-Path $f.DirectoryName "latest.json"
[System.IO.File]::WriteAllText($out, $json, (New-Object System.Text.UTF8Encoding $false))
Write-Host "만들었습니다: $out"
Write-Host $json
