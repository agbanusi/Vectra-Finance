#!/usr/bin/env bash
# LOCAL DEVELOPMENT ONLY: starts anvil and deploys the mock demo (writes deployments/31337.json).
set -euo pipefail
cd "$(dirname "$0")/.."
ANVIL_KEY0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil default, public
anvil --silent --port 8545 --block-time "${BLOCK_TIME:-2}" &
ANVIL_PID=$!
trap 'kill $ANVIL_PID' EXIT
until cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do sleep 0.5; done
forge script script/LocalDemo.s.sol --rpc-url http://127.0.0.1:8545 --private-key "$ANVIL_KEY0" --broadcast >/dev/null
echo "Demo deployed: deployments/31337.json"
wait $ANVIL_PID
