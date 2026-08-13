# Prints the IPv4 address your phone can actually reach this computer on.
#
# Picking the first address out of `ipconfig` is not good enough: a typical dev
# machine also has VirtualBox, WSL, Hyper-V, Docker and VPN adapters, and none
# of those addresses are reachable from a phone on your Wi-Fi. On this machine
# the naive pick returned 192.168.56.1 (VirtualBox) and the routing-table pick
# returned a Radmin VPN address — both wrong.
#
# So: require a real default gateway, exclude virtual and VPN adapters by name,
# and prefer the lowest route metric, which is the connection Windows itself
# prefers. Prints nothing if it can't find one, so callers can fall back.

$adapter = Get-NetIPConfiguration |
  Where-Object {
    $_.IPv4Address -and
    $_.IPv4DefaultGateway -and
    $_.NetAdapter.Status -eq 'Up' -and
    $_.InterfaceAlias -notmatch 'VPN|Virtual|vEthernet|WSL|Hyper-V|Loopback|Radmin|TAP|Tailscale|ZeroTier|Bluetooth'
  } |
  Sort-Object { $_.IPv4DefaultGateway.RouteMetric } |
  Select-Object -First 1

if ($adapter) { $adapter.IPv4Address.IPAddress }
