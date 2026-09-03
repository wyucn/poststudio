# 流水线端到端验证脚本（需 dev 服务器运行中，且已注册测试账号）
param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Email = "vivian@arkstudio.local",
  [string]$Password = "test123456",
  [string]$ProjectId = $env:E2E_PROJECT_ID
)

$ErrorActionPreference = "Stop"

# 1. 登录
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$csrf = (Invoke-RestMethod -Uri "$BaseUrl/api/auth/csrf" -WebSession $s).csrfToken
$emailEnc = [uri]::EscapeDataString($Email)
Invoke-WebRequest -Uri "$BaseUrl/api/auth/callback/credentials" -Method POST `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "csrfToken=$csrf&email=$emailEnc&password=$Password" `
  -WebSession $s -UseBasicParsing | Out-Null
Write-Host "[1/5] 登录成功"

# 2. 创建分镜（LLM）
$body = @{ idea = "一只蓝色小鸟清晨在湖面上飞翔，最终落在芦苇上，治愈系"; shotCount = 2 } | ConvertTo-Json
$sb = Invoke-RestMethod -Uri "$BaseUrl/api/projects/$ProjectId/storyboards" -Method POST `
  -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
  -WebSession $s -TimeoutSec 180
Write-Host "[2/5] 分镜已生成：$($sb.title)（$($sb.id)）"
$detail = Invoke-RestMethod -Uri "$BaseUrl/api/storyboards/$($sb.id)" -WebSession $s
$shot = $detail.shots[0]
Write-Host "      镜头1：$($shot.title) / $($shot.imagePrompt.Substring(0, [Math]::Min(40, $shot.imagePrompt.Length)))..."

# 3. 生成首帧
$r = Invoke-RestMethod -Uri "$BaseUrl/api/storyboards/$($sb.id)/shots/$($shot.id)/image" -Method POST `
  -ContentType "application/json" -Body '{"modelKey":"seedream-5.0","size":"2k"}' -WebSession $s -TimeoutSec 120
Write-Host "[3/5] 首帧已生成：asset $($r.asset.id)"

# 4. 提交视频任务（fast 模型 480p 省时省钱）
$r = Invoke-RestMethod -Uri "$BaseUrl/api/storyboards/$($sb.id)/shots/$($shot.id)/video" -Method POST `
  -ContentType "application/json" -Body '{"modelKey":"seedance-2.0-fast","resolution":"480p"}' -WebSession $s -TimeoutSec 60
Write-Host "[4/5] 视频任务已提交：task $($r.task.id)（方舟 $($r.task.arkTaskId)）"

# 5. 等待轮询器完成转存
$t0 = Get-Date
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 10
  $detail = Invoke-RestMethod -Uri "$BaseUrl/api/storyboards/$($sb.id)" -WebSession $s
  $shot = $detail.shots | Where-Object { $_.id -eq $shot.id }
  $elapsed = [int]((Get-Date) - $t0).TotalSeconds
  Write-Host "      [$elapsed s] videoStatus = $($shot.videoStatus)"
  if ($shot.videoStatus -eq "succeeded") {
    Write-Host "[5/5] 视频已转存：asset $($shot.videoAssetId)"
    Write-Host "=== 流水线端到端验证通过 ==="
    exit 0
  }
  if ($shot.videoStatus -eq "failed") {
    Write-Host "视频生成失败：$($shot.videoError)"
    exit 1
  }
}
Write-Host "超时未完成"
exit 1
