import { ApiResponse, Greeting } from '../types';

/**
 * Create a standardized API response
 */
export function createApiResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date(),
  };
}

/**
 * Create an error API response
 */
export function createErrorResponse(error: string, statusCode: number = 500): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date(),
  };
}

/**
 * Create a greeting response
 */
export function createGreeting(message: string): Greeting {
  return {
    message,
    timestamp: new Date(),
    server: 'Oasis TEE TDX Middleman',
  };
}

