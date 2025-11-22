// Type definitions for Oasis Middleman

export interface HealthResponse {
    status: string;
    service: string;
    timestamp?: number;
}

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp?: Date;
}

export interface NameAddressPair {
    name: string;
    address: string;
}

export interface Greeting {
    message: string;
    timestamp: Date;
    server: string;
}

// JustaName API Types
export interface JustaNameAddSubnameRequest {
    ens: string;
    name: string;
    owner: string;
    providerUrl: string;
    duration?: number;
    resolver?: string;
    records?: JustaNameTextRecords;
}

export interface JustaNameUpdateSubnameRequest {
    ens: string;
    name: string;
    owner?: string;
    providerUrl: string;
    resolver?: string;
    records?: JustaNameTextRecords;
}

export interface JustaNameTextRecords {
    description?: string;
    url?: string;
    avatar?: string;
    'com.twitter'?: string;
    'com.github'?: string;
    [key: string]: string | undefined;
}

export interface JustaNameSubnameResponse {
    name: string;
    owner?: string;
    resolver?: string;
    records?: JustaNameTextRecords;
}

export interface JustaNameRecordsResponse {
    name: string;
    records: JustaNameTextRecords;
}

// SIWE (Sign-In with Ethereum) Types
export interface JustaNameRequestChallengeRequest {
    ens: string;
    address: string;
    providerUrl: string;
    domain: string;
    origin: string;
    chainId: number;
}

export interface JustaNameRequestChallengeResponse {
    challenge?: string;  // JustaName API returns 'challenge' instead of 'message'
    message?: string;    // Keep for backward compatibility
    nonce?: string;
}

export interface JustaNameVerifyMessageRequest {
    ens: string;
    address: string;
    message: string;
    signature: string;
    providerUrl: string;
}

export interface JustaNameVerifyMessageResponse {
    verified?: boolean;  // JustaName API returns 'verified' instead of 'success'
    success?: boolean;  // Keep for backward compatibility
    token?: string;
    accessToken?: string;  // Token might be in a different field
}

export interface JustaNameAddMappPermissionRequest {
    ens: string;
    name: string;
    mappId: string;
    fields: string[];
    providerUrl: string;
}
