/**
 * JustaName API Client
 * Uses Next.js API routes (server-side) to keep private key secure
 */

import { requestSIWEChallenge } from './justaname-siwe';

const API_BASE_URL = '/api/subdomain';

export interface SubnameRegistrationData {
  subname: string;
  description?: string;
  resolutionAddress?: string;
  userSignature?: string;
  userAddress?: string;
  challengeMessage?: string;
}

export interface SubnameUpdateData {
  subname: string;
  description?: string;
  resolutionAddress?: string;
  userSignature?: string;
  userAddress?: string;
  challengeMessage?: string;
}

export interface SubnameInfo {
  name: string;
  address: string;
  description?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: string;
}

/**
 * Register a new subdomain via server-side API
 */
export async function registerSubdomain(data: SubnameRegistrationData): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP error! status: ${response.status}`,
      };
    }

    return result;
  } catch (error) {
    console.error('Error registering subdomain:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to register subdomain',
    };
  }
}

/**
 * Get all registered subdomains for a specific address via server-side API
 */
export async function getAllSubdomains(address?: string): Promise<ApiResponse<{ count: number; names: SubnameInfo[] }>> {
  try {
    // If no address provided, return empty list
    if (!address) {
      return {
        success: true,
        data: {
          count: 0,
          names: [],
        },
      };
    }

    const response = await fetch(`${API_BASE_URL}/names?address=${encodeURIComponent(address)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP error! status: ${response.status}`,
      };
    }

    return result;
  } catch (error) {
    console.error('Error fetching subdomains:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch subdomains',
    };
  }
}

/**
 * Check if a subdomain is available (not registered)
 */
export async function checkSubdomainAvailability(subname: string): Promise<{ available: boolean; error?: string }> {
  try {
    const response = await getAllSubdomains();
    
    if (!response.success || !response.data) {
      return { available: true, error: 'Could not verify availability' };
    }

    const exists = response.data.names.some(
      (s) => s.name.toLowerCase() === subname.toLowerCase()
    );

    return { available: !exists };
  } catch (error) {
    console.error('Error checking subdomain availability:', error);
    return { available: true, error: 'Could not verify availability' };
  }
}

/**
 * Get subdomain details by name
 */
export async function getSubdomainDetails(subname: string): Promise<SubnameInfo | null> {
  try {
    const response = await getAllSubdomains();
    
    if (!response.success || !response.data) {
      return null;
    }

    const subdomain = response.data.names.find(
      (s) => s.name.toLowerCase() === subname.toLowerCase()
    );

    return subdomain || null;
  } catch (error) {
    console.error('Error fetching subdomain details:', error);
    return null;
  }
}

/**
 * Update an existing subdomain via server-side API
 */
export async function updateSubdomain(data: SubnameUpdateData): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE_URL}/update`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    const result = await response.json();
    
    if (!response.ok) {
      return {
        success: false,
        error: result.error || `HTTP error! status: ${response.status}`,
      };
    }

    return result;
  } catch (error) {
    console.error('Error updating subdomain:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update subdomain',
    };
  }
}

