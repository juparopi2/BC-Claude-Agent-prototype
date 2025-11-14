/**
 * JSON Type Definitions and Utilities
 *
 * This module provides type-safe handling of JSON data in TypeScript.
 * Uses the industry-standard JSONValue pattern (also used by Prisma, tRPC, etc.)
 *
 * @module json-utils
 */

/**
 * JSONValue - Represents any valid JSON value
 *
 * This is a recursive type that covers all possible JSON structures:
 * - Primitives: string, number, boolean, null
 * - Arrays: JSONValue[]
 * - Objects: { [key: string]: JSONValue }
 *
 * This type is used for dynamic data like tool arguments and results
 * that come from MCP tools with JSON Schema-defined inputs.
 *
 * @example
 * const valid: JSONValue = { name: "John", age: 30, tags: ["dev", "ts"] };
 * const alsoValid: JSONValue = [1, "two", { three: 3 }];
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
 * Use this when you know the value is an object/record.
 *
 * @example
 * const toolArgs: JSONObject = { filename: "test.txt", content: "Hello" };
 */
export type JSONObject = { [key: string]: JSONValue };

/**
 * JSONArray - Specifically represents JSON arrays
 *
 * Use this when you know the value is an array.
 *
 * @example
 * const items: JSONArray = [1, "two", { three: 3 }];
 */
export type JSONArray = JSONValue[];

/**
 * Safely converts a JSONValue to a string suitable for React rendering
 *
 * This function handles all JSONValue types and always returns a string,
 * making it safe to use in React components without type assertions.
 *
 * @param value - Any JSONValue (from tool args, tool results, etc.)
 * @param pretty - Whether to pretty-print objects/arrays with indentation (default: true)
 * @returns A string safe for rendering in React
 *
 * @example
 * // In a React component
 * <pre>{jsonToString(message.tool_args)}</pre>
 *
 * // Compact output
 * <span>{jsonToString(value, false)}</span>
 */
export function jsonToString(value: JSONValue, pretty: boolean = true): string {
  // Handle null explicitly
  if (value === null) {
    return 'null';
  }

  // Primitives - convert directly
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  // Objects and arrays - use JSON.stringify
  try {
    return pretty
      ? JSON.stringify(value, null, 2)
      : JSON.stringify(value);
  } catch (error) {
    // Fallback for circular references or other errors
    return '[Serialization Error]';
  }
}

/**
 * Type guard to check if a value is a valid JSONValue
 *
 * This is useful when converting from `unknown` (e.g., from Anthropic SDK)
 * to `JSONValue` at runtime.
 *
 * @param value - Any value to check
 * @returns true if the value is a valid JSONValue
 *
 * @example
 * const sdkInput: unknown = toolUseBlock.input; // From Anthropic SDK
 *
 * if (isJSONValue(sdkInput)) {
 *   const args: JSONValue = sdkInput; // Type narrowing works!
 *   console.log(jsonToString(args));
 * }
 */
export function isJSONValue(value: unknown): value is JSONValue {
  // null is a valid JSON value
  if (value === null) {
    return true;
  }

  const type = typeof value;

  // Primitives are valid
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return true;
  }

  // Arrays - recursively check all elements
  if (Array.isArray(value)) {
    return value.every(isJSONValue);
  }

  // Objects - recursively check all values
  if (type === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).every(isJSONValue);
  }

  // undefined, functions, symbols, etc. are not valid JSON
  return false;
}

/**
 * Type guard to check if a value is a JSON object (not array or primitive)
 *
 * @param value - Any value to check
 * @returns true if the value is a JSONObject
 *
 * @example
 * if (isJSONObject(data)) {
 *   const obj: JSONObject = data;
 *   console.log(Object.keys(obj));
 * }
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
 *
 * @example
 * if (isJSONArray(data)) {
 *   const arr: JSONArray = data;
 *   console.log(arr.length);
 * }
 */
export function isJSONArray(value: unknown): value is JSONArray {
  return isJSONValue(value) && Array.isArray(value);
}
