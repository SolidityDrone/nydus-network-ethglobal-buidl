#!/bin/bash

# Script to build and generate verifiers for all Nydus circuits
# This script executes the following for each circuit:
# 1. nargo execute <witness-name>
# 2. bb prove -b ./target/<circuit-name>.json -w ./target/<witness-name> -o ./target --oracle_hash keccak
# 3. bb write_vk -b ./target/<noir_artifact_name>.json -o ./target --oracle_hash keccak
# 4. bb write_solidity_verifier -k ./target/vk -o ../target/Verifier.sol

set -e  # Exit on any error

# Array of circuit names (using hyphens as they appear in folder names)
circuits=("nydus-entry" "nydus-send" "nydus-absorb" "nydus-deposit" "nydus-withdraw")

# Function to process a single circuit
process_circuit() {
    local circuit_folder=$1
    local circuit_name=${circuit_folder//-/_}  # Convert hyphens to underscores for target files
    local witness_name="${circuit_name}.gz"
    
    echo "=========================================="
    echo "Processing circuit: $circuit_folder (target: $circuit_name)"
    echo "=========================================="
    
    # Change to the circuit directory
    cd "main/$circuit_folder" || {
        echo "Error: Could not find directory main/$circuit_folder"
        exit 1
    }
    
    echo "Step 1: Executing nargo execute for $witness_name"
    nargo execute "$witness_name" || {
        echo "Error: nargo execute failed for $circuit_name"
        exit 1
    }
    
    echo "Step 2: Generating proof with bb prove"
    bb prove -b "../../target/${circuit_name}.json" -w "../../target/${witness_name}" -o "../../target" --oracle_hash keccak || {
        echo "Error: bb prove failed for $circuit_name"
        exit 1
    }
    
    echo "Step 3: Writing verification key with bb write_vk"
    bb write_vk -b "../../target/${circuit_name}.json" -o "../../target" --oracle_hash keccak || {
        echo "Error: bb write_vk failed for $circuit_name"
        exit 1
    }
    
    echo "Step 4: Writing Solidity verifier directly to contracts directory"
    # Convert circuit_name to proper case for verifier name (e.g., nydus_entry -> Absorb)
    local verifier_name=$(echo "$circuit_name" | sed 's/nydus_//' | sed 's/\([a-z]\)/\U\1/')
    bb write_solidity_verifier -k "../../target/vk" -o "../../../contracts/src/Verifiers/Verifier${verifier_name}.sol" || {
        echo "Error: bb write_solidity_verifier failed for $circuit_name"
        exit 1
    }
    
    # Return to circuits directory
    cd ../..
    
    echo "Successfully processed $circuit_name"
    echo ""
}

# Main execution
echo "Starting circuit build process..."
echo "Processing ${#circuits[@]} circuits: ${circuits[*]}"
echo ""

# Ensure the Verifiers directory exists
echo "Ensuring Verifiers directory exists..."
mkdir -p "../contracts/src/Verifiers" || {
    echo "Error: Could not create Verifiers directory"
    exit 1
}
echo ""

# Process each circuit
for circuit in "${circuits[@]}"; do
    process_circuit "$circuit"
done

echo "=========================================="
echo "All circuits processed successfully!"
echo "Verifiers copied to contracts/src/Verifiers/"
echo "=========================================="
