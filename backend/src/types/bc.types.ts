/**
 * Business Central Type Definitions
 *
 * Types for Business Central entities, API requests, and responses.
 * Based on BC OData v4 API structure.
 */

/**
 * Base BC Entity
 * Common fields for all BC entities
 */
export interface BCBaseEntity {
  /** Unique identifier (GUID) */
  id: string;
  /** Entity number (human-readable identifier) */
  number?: string;
  /** Display name */
  displayName: string;
  /** Last modified timestamp */
  lastModifiedDateTime?: string;
}

/**
 * BC Customer Entity
 * Represents a customer in Business Central
 */
export interface BCCustomer extends BCBaseEntity {
  /** Customer type (Person or Company) */
  type?: 'Company' | 'Person';
  /** Email address */
  email?: string;
  /** Phone number */
  phoneNumber?: string;
  /** Website URL */
  website?: string;
  /** Tax liable */
  taxLiable?: boolean;
  /** Tax area code */
  taxAreaCode?: string;
  /** Tax registration number */
  taxRegistrationNumber?: string;
  /** Currency code */
  currencyCode?: string;
  /** Payment terms ID */
  paymentTermsId?: string;
  /** Shipment method ID */
  shipmentMethodId?: string;
  /** Payment method ID */
  paymentMethodId?: string;
  /** Blocked status */
  blocked?: '' | 'Ship' | 'Invoice' | 'All';
  /** Balance */
  balance?: number;
  /** Overdraft limit */
  overdueAmount?: number;
}

/**
 * BC Vendor Entity
 * Represents a vendor in Business Central
 */
export interface BCVendor extends BCBaseEntity {
  /** Email address */
  email?: string;
  /** Phone number */
  phoneNumber?: string;
  /** Website URL */
  website?: string;
  /** Tax registration number */
  taxRegistrationNumber?: string;
  /** Currency code */
  currencyCode?: string;
  /** Payment terms ID */
  paymentTermsId?: string;
  /** Payment method ID */
  paymentMethodId?: string;
  /** Blocked status */
  blocked?: '' | 'Payment' | 'All';
  /** Balance */
  balance?: number;
}

/**
 * BC Item Entity
 * Represents an item/product in Business Central
 */
export interface BCItem extends BCBaseEntity {
  /** Item type */
  type?: 'Inventory' | 'Service' | 'Non-Inventory';
  /** Item category ID */
  itemCategoryId?: string;
  /** Item category code */
  itemCategoryCode?: string;
  /** Base unit of measure */
  baseUnitOfMeasureId?: string;
  /** Base unit of measure code */
  baseUnitOfMeasure?: string;
  /** GTIN (barcode) */
  gtin?: string;
  /** Inventory quantity */
  inventory?: number;
  /** Unit price */
  unitPrice?: number;
  /** Unit cost */
  unitCost?: number;
  /** Tax group code */
  taxGroupCode?: string;
  /** Blocked */
  blocked?: boolean;
}

/**
 * BC Sales Order Entity
 * Represents a sales order in Business Central
 */
export interface BCSalesOrder extends BCBaseEntity {
  /** Customer ID */
  customerId: string;
  /** Customer number */
  customerNumber?: string;
  /** Customer name */
  customerName?: string;
  /** Order date */
  orderDate: string;
  /** Posting date */
  postingDate?: string;
  /** Shipment date */
  shipmentDate?: string;
  /** Status */
  status?: 'Draft' | 'In Review' | 'Open';
  /** Currency code */
  currencyCode?: string;
  /** Total amount excluding tax */
  totalAmountExcludingTax?: number;
  /** Total amount including tax */
  totalAmountIncludingTax?: number;
  /** Sales order lines */
  salesOrderLines?: BCSalesOrderLine[];
}

/**
 * BC Sales Order Line
 * Represents a line in a sales order
 */
export interface BCSalesOrderLine {
  /** Line ID */
  id: string;
  /** Line sequence number */
  sequence: number;
  /** Item ID */
  itemId?: string;
  /** Account ID (for non-item lines) */
  accountId?: string;
  /** Line type */
  lineType: 'Item' | 'Account' | 'Comment';
  /** Description */
  description?: string;
  /** Quantity */
  quantity: number;
  /** Unit of measure ID */
  unitOfMeasureId?: string;
  /** Unit price */
  unitPrice?: number;
  /** Discount amount */
  discountAmount?: number;
  /** Discount percent */
  discountPercent?: number;
  /** Line amount excluding tax */
  lineAmountExcludingTax?: number;
  /** Tax percent */
  taxPercent?: number;
}

/**
 * BC Query Options
 * OData query parameters for BC API requests
 */
export interface BCQueryOptions {
  /** OData $filter expression */
  filter?: string;
  /** OData $select fields */
  select?: string[];
  /** OData $expand related entities */
  expand?: string[];
  /** OData $orderby expression */
  orderBy?: string;
  /** OData $top (limit) */
  top?: number;
  /** OData $skip (offset) */
  skip?: number;
  /** Include $count in response */
  count?: boolean;
}

/**
 * BC API Response
 * Standard OData v4 collection response from BC API
 */
export interface BCApiResponse<T> {
  /** Array of entities */
  value: T[];
  /** Total count (if $count=true) */
  '@odata.count'?: number;
  /** Next page link (for pagination) */
  '@odata.nextLink'?: string;
  /** OData context */
  '@odata.context'?: string;
}

/**
 * BC API Single Entity Response
 * Response for single entity operations (create, update, get by ID)
 */
export type BCSingleEntityResponse<T> = T & {
  /** OData context */
  '@odata.context'?: string;
  /** OData etag for concurrency */
  '@odata.etag'?: string;
};

/**
 * BC API Error Response
 * Error response from BC API
 */
export interface BCApiError {
  /** Error details */
  error: {
    /** Error code */
    code: string;
    /** Error message */
    message: string;
    /** Inner error details */
    innererror?: {
      /** Exception type */
      type?: string;
      /** Exception message */
      message?: string;
    };
  };
}

/**
 * BC OAuth Token Response
 * Response from Microsoft OAuth token endpoint
 */
export interface BCOAuthTokenResponse {
  /** Access token */
  access_token: string;
  /** Token type (usually 'Bearer') */
  token_type: string;
  /** Expiration time in seconds */
  expires_in: number;
  /** Extended expiration time in seconds */
  ext_expires_in?: number;
  /** Scope of the token */
  scope?: string;
}

/**
 * BC Validation Result
 * Result from BC validation operations
 */
export interface BCValidationResult {
  /** Is data valid */
  valid: boolean;
  /** Validation errors */
  errors: Array<{
    /** Field name */
    field: string;
    /** Error message */
    message: string;
    /** Error code */
    code?: string;
  }>;
}

/**
 * BC Entity Types
 * Union type of all supported BC entity types
 */
export type BCEntity =
  | BCCustomer
  | BCVendor
  | BCItem
  | BCSalesOrder
  | BCSalesOrderLine;

/**
 * BC Entity Type Names
 * String literal types for entity names
 */
export type BCEntityType =
  | 'customers'
  | 'vendors'
  | 'items'
  | 'salesOrders'
  | 'purchaseOrders';
