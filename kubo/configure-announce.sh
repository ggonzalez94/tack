#!/bin/sh
set -e

# Configure the public swarm announce address for DHT discoverability.
#
# Without this, Kubo only advertises container-internal addresses in the DHT,
# so public IPFS gateways (ipfs.io, dweb.link) can find the provider record
# but cannot connect to fetch the content (results in 504 timeouts).
#
# On Railway: set IPFS_ANNOUNCE_ADDRESS to the public TCP address assigned
# when you expose port 4001, e.g.:
#   /dns4/monorail.proxy.rlwy.net/tcp/12345
#
# For local Docker Compose: not required (local networking is direct).

if [ -z "$IPFS_ANNOUNCE_ADDRESS" ]; then
  echo "configure-announce: IPFS_ANNOUNCE_ADDRESS not set — skipping."
  echo "  Swarm will only advertise container-internal addresses."
  echo "  Content may not be reachable from public IPFS gateways."
  exit 0
fi

echo "configure-announce: setting AppendAnnounce to $IPFS_ANNOUNCE_ADDRESS"
ipfs config --json Addresses.AppendAnnounce "[\"$IPFS_ANNOUNCE_ADDRESS\"]"
