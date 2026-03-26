# Disable Audio Enhancements and Exclusive Mode for all rendering devices to fix delay
$mmDevicesKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render"
$devices = Get-ChildItem -Path $mmDevicesKey

foreach ($device in $devices) {
    $propertiesPath = Join-Path $device.PSPath "Properties"
    
    # 1. Disable Audio Enhancements (Bitmask 1)
    # GUID: {13306611-cf08-410a-8105-ee9b4f2c0695}, 3
    $enhancementId = "{13306611-cf08-410a-8105-ee9b4f2c0695},3"
    
    # 2. Disable Exclusive Mode
    # GUID: {b3f12a6d-3807-4a51-9186-31e4af0cfc10}, 2 and 3
    $exclusiveMode1 = "{b3f12a6d-3807-4a51-9186-31e4af0cfc10},2"
    $exclusiveMode2 = "{b3f12a6d-3807-4a51-9186-31e4af0cfc10},3"

    try {
        Set-ItemProperty -Path $propertiesPath -Name $enhancementId -Value 1 -Type DWord -ErrorAction SilentlyContinue
        Set-ItemProperty -Path $propertiesPath -Name $exclusiveMode1 -Value 0 -Type DWord -ErrorAction SilentlyContinue
        Set-ItemProperty -Path $propertiesPath -Name $exclusiveMode2 -Value 0 -Type DWord -ErrorAction SilentlyContinue
        Write-Host "Applied low-latency fix to device: $($device.PSChildName)"
    } catch {
        Write-Warning "Could not update properties for $($device.PSChildName)"
    }
}

# Restart Windows Audio Service to apply changes
Restart-Service -Name "AudioEndpointBuilder" -Force
Restart-Service -Name "Audiosrv" -Force
Write-Host "Audio services restarted. Delay should be gone."
