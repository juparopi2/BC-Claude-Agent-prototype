/**
 * JSON Type Definitions
 *
 * Shared type definitions for JSON data structures.
 * These types match the frontend's json-utils.ts for consistency.
 *
 * Used for tool arguments and results that come from MCP tools
 * with JSON Schema-defined inputs.
 *
 * @module json.types
 */

/**
 * JSONValue - Represents any valid JSON value
 *
 * This is a recursive type that covers all possible JSON structures:
 * - Primitives: string, number, boolean, null
 * - Arrays: JSONValue[]
 * - Objects: { [key: string]: JSONValue }
 *
 * @example
 * const toolResult: JSONValue = { success: true, data: { id: 123 } };
 */
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * JSONObject - Specifically represents JSON objects (not arrays or primitives)
 *
 * Use this for tool arguments, approval changes, etc.
 *
 * @example
 * const toolArgs: JSONObject = { operation: "create", params: { name: "test" } };
 */
export type JSONObject = { [key: string]: JSONValue };

/**
 * JSONArray - Specifically represents JSON arrays
 *
 * @example
 * const items: JSONArray = [1, "two", { three: 3 }];
 */
export type JSONArray = JSONValue[];

/**
 * Type guard to check if a value is a valid JSONValue
 *
 * Useful when converting from `unknown` (e.g., from Anthropic SDK)
 * to `JSONValue` at runtime.
 *
 * @param value - Any value to check
 * @returns true if the value is a valid JSONValue
 *
 * @example
 * const sdkInput: unknown = toolUseBlock.input; // From Anthropic SDK
 *
 * if (isJSONValue(sdkInput)) {
 *   const args: JSONValue = sdkInput;
 *   // Now type-safe to use
 * }
 */
export function isJSONValue(value: unknown): value is JSONValue {
  if (value === null) {
    return true;
  }

  const type = typeof value;

  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJSONValue);
  }

  if (type === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).every(isJSONValue);
  }

  return false;
}

/**
 * Type guard to check if a value is a JSON object
 *
 * @param value - Any value to check
 * @returns true if the value is a JSONObject
 */
export function isJSONObject(value: unknown): value is JSONObject {
  return (
    isJSONValue(value) &&
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Type guard to check if a value is a JSON array
 *
 * @param value - Any value to check
 * @returns true if the value is a JSONArray
 */
export function isJSONArray(value: unknown): value is JSONArray {
  return isJSONValue(value) && Array.isArray(value);
}
