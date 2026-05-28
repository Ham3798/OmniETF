#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/../contracts"
forge test
forge script script/Demo.s.sol -vvvv
