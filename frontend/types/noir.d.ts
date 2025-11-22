declare module '@noir-lang/noir_js' {
    export class Noir {
        constructor(circuit: { bytecode: any }, options?: {
            foreignCallHandler?: (name: string, args: any[]) => Promise<any>;
        });
        execute(inputs: any, foreignCallHandler?: (name: string, args: any[]) => Promise<any>): Promise<{ witness: any }>;
    }
}

declare module '@aztec/bb.js' {
    export class UltraHonkBackend {
        constructor(bytecode: any, options?: { threads: number }, options2?: { recursive: boolean });
        generateProof(witness: any, options?: any): Promise<{ proof: string; publicInputs: any[] }>;
        generateProofForRecursiveAggregation(witness: any): Promise<{ proof: string; publicInputs: any[] }>;
        generateRecursiveProofArtifacts(proof: string, publicInputElements: number): Promise<{ vkAsFields: any[] }>;
        verifyProof(proof: any): Promise<boolean>;
    }
} 