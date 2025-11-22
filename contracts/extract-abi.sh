#!/bin/bash

# Extract ABI from Nydus.json using jq
jq '.abi' out/Nydus.sol/Nydus.json > Nydus.abi.json

echo "ABI extracted to Nydus.abi.json"

