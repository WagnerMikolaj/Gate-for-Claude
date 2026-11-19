#Requires -RunAsAdministrator
#Requires -Modules ConfigCI
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ApprovedApplicationDirectory,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [ValidateSet('Audit', 'Enforced')][string]$Mode = 'Audit'
)
$ErrorActionPreference = 'Stop'
# Artifact generation only. This script does not deploy or activate device policies.
$approvedPath = (Resolve-Path -LiteralPath $ApprovedApplicationDirectory).Path
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $approvedPath -PathType Container)) { throw 'Expected a directory of approved application binaries.' }
if ($approvedPath -eq [IO.Path]::GetPathRoot($approvedPath)) { throw 'Do not scan a drive root; use a curated reference directory.' }
$baseTemplate = Join-Path $env:windir 'schemas\CodeIntegrity\ExamplePolicies\DefaultWindows_Audit.xml'
if (-not (Test-Path -LiteralPath $baseTemplate)) { throw 'Windows App Control reference policy is unavailable on this system.' }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$appsPolicy = Join-Path $outputPath 'Gate-ApprovedApps.xml'
$mergedPolicy = Join-Path $outputPath 'Gate-Base.xml'
if ((Test-Path -LiteralPath $appsPolicy) -or (Test-Path -LiteralPath $mergedPolicy)) { throw 'Use a new output directory to preserve prior policy artifacts.' }
# Exact hash rules for curated applications, avoiding a blanket third-party publisher allow rule.
New-CIPolicy -ScanPath $approvedPath -FilePath $appsPolicy -Level Hash -UserPEs -MultiplePolicyFormat | Out-Null
Merge-CIPolicy -PolicyPaths @($baseTemplate, $appsPolicy) -OutputFilePath $mergedPolicy | Out-Null
Set-CIPolicyIdInfo -FilePath $mergedPolicy -PolicyName "Gate workstations - $Mode" -ResetPolicyID | Out-Null
Set-RuleOption -FilePath $mergedPolicy -Option 0 # User mode code integrity
if ($Mode -eq 'Enforced') {
    Set-RuleOption -FilePath $mergedPolicy -Option 3 -Delete
} else {
    Set-RuleOption -FilePath $mergedPolicy -Option 3
}
$binaryPath = Join-Path $outputPath 'Gate-Base.cip'
ConvertFrom-CIPolicy -XmlFilePath $mergedPolicy -BinaryFilePath $binaryPath
Write-Output "Generated $Mode policy artifacts at $outputPath. No device policy was installed."
Write-Output 'Review Windows baseline, approved interpreters, Microsoft recommended block rules and recovery procedure before deployment through MDM.'
