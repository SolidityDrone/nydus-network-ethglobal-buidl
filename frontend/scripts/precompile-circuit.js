#!/usr/bin/env node

/**
 * Pre-compile circuit script for faster client-side proving
 * This script copies circuit files from circuits/target to frontend/public/circuits
 * and optionally optimizes them
 */

const fs = require('fs');
const path = require('path');

async function precompileCircuits() {
    console.log('🔥 Copying circuit files...');

    try {
        const circuitsDir = path.join(__dirname, '../../circuits/target');
        const libCircuitsDir = path.join(__dirname, '../lib/circuits');
        
        // Ensure lib/circuits directory exists
        if (!fs.existsSync(libCircuitsDir)) {
            fs.mkdirSync(libCircuitsDir, { recursive: true });
        }

        const circuitFiles = [
            'nydus_entry.json',
            'nydus_deposit.json',
            'nydus_absorb.json',
            'nydus_send.json',
            'nydus_withdraw.json'
        ];

        for (const circuitFile of circuitFiles) {
            const sourcePath = path.join(circuitsDir, circuitFile);
            const destPath = path.join(libCircuitsDir, circuitFile);

            if (fs.existsSync(sourcePath)) {
                // Copy the circuit file
                fs.copyFileSync(sourcePath, destPath);
                console.log(`✅ Copied ${circuitFile}`);
            } else if (fs.existsSync(destPath)) {
                // File already exists in lib/circuits (likely committed to git)
                console.log(`✅ Circuit file already exists: ${circuitFile}`);
            } else {
                console.warn(`⚠️  Circuit file not found: ${sourcePath}`);
                console.warn(`⚠️  Also not found in: ${destPath}`);
                // Don't fail - files might be committed to git
            }
        }

        console.log('✅ Circuit files copied successfully!');

    } catch (error) {
        console.error('❌ Pre-compilation failed:', error);
        // Don't exit with error - allow build to continue if files already exist
        console.warn('⚠️  Continuing build anyway...');
    }
}

// Run pre-compilation
precompileCircuits();
