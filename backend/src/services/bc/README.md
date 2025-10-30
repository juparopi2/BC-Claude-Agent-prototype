# Business Central Services

This directory contains services for direct interaction with Microsoft Business Central API.

## Overview

The BC services provide:
- **BCClient**: Direct API client with OAuth 2.0 authentication
- **BCValidator**: Business logic validation for BC entities

## When to Use These Services

### BCClient (Direct API)

Use BCClient for:
1. **Health checks** - Validate BC connectivity
2. **Validation queries** - Check if entity exists before update
3. **Schema introspection** - Get entity metadata for UI
4. **Debugging** - Compare results with MCP tool calls

**Do NOT use for normal operations** - Use MCP tools via Agent SDK instead.

### BCValidator

Use BCValidator for:
1. **Pre-submission validation** - Validate data before MCP tool calls
2. **Form validation** - Validate user input in UI
3. **Business rule enforcement** - Check business logic constraints

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Normal Flow (Preferred)                             │
│                                                      │
│ User → Agent SDK → MCP → BC API                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ Direct Flow (Health Checks, Validation)             │
│                                                      │
│ Health Check → BCClient → BC OAuth → BC API         │
│ Form Data → BCValidator (client-side validation)    │
└─────────────────────────────────────────────────────┘
```

## Usage Examples

### BCClient - Authentication & Queries

```typescript
import { getBCClient } from '@/services/bc';

const bcClient = getBCClient();

// Validate credentials
const isValid = await bcClient.validateCredentials();
console.log('BC credentials valid:', isValid);

// Test connection
const connected = await bcClient.testConnection();
console.log('BC connected:', connected);

// Query customers
const customers = await bcClient.query('customers', {
  filter: "blocked eq ''",
  select: ['id', 'displayName', 'email'],
  top: 10,
});

console.log('Found customers:', customers.value.length);

// Get single customer
const customer = await bcClient.getById('customers', 'some-guid');
console.log('Customer:', customer.displayName);

// Create customer (prefer using MCP tools instead)
const newCustomer = await bcClient.create('customers', {
  displayName: 'Acme Corp',
  email: 'contact@acme.com',
});

// Update customer
const updated = await bcClient.update('customers', customer.id, {
  email: 'newemail@acme.com',
});

// Delete customer
await bcClient.delete('customers', customer.id);
```

### BCClient - Token Management

```typescript
import { getBCClient } from '@/services/bc';

const bcClient = getBCClient();

// Check token status
const status = bcClient.getTokenStatus();
console.log('Has token:', status.hasToken);
console.log('Expires at:', status.expiresAt);

// Clear token (force re-authentication)
bcClient.clearTokenCache();
```

### BCValidator - Entity Validation

```typescript
import { getBCValidator } from '@/services/bc';

const validator = getBCValidator();

// Validate customer
const customerData = {
  displayName: 'Acme Corp',
  email: 'invalid-email', // Invalid!
  phoneNumber: '123-456-7890',
};

const result = validator.validateCustomer(customerData);

if (!result.valid) {
  console.error('Validation errors:');
  result.errors.forEach((error) => {
    console.error(`- ${error.field}: ${error.message}`);
  });

  // Or format all errors
  console.error(validator.formatErrors(result));
}

// Validate vendor
const vendorData = {
  displayName: 'Vendor Inc',
  balance: -100, // Invalid - negative balance!
};

const vendorResult = validator.validateVendor(vendorData);

// Validate item
const itemData = {
  displayName: 'Widget',
  unitPrice: 50,
  unitCost: 100, // Warning - price < cost!
  inventory: -5, // Invalid - negative inventory!
};

const itemResult = validator.validateItem(itemData);
```

### BCValidator - Field Validation

```typescript
import { getBCValidator } from '@/services/bc';

const validator = getBCValidator();

// Validate GUID
const isValidGuid = validator.isValidGuid('550e8400-e29b-41d4-a716-446655440000');
console.log('Valid GUID:', isValidGuid);

// Format errors for display
const result = validator.validateCustomer({ displayName: '' });
const errorMessage = validator.formatErrors(result);
console.log(errorMessage); // "displayName: Customer display name is required"
```

## Business Central API Details

### OAuth 2.0 Configuration

```
Token Endpoint: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
Grant Type: client_credentials
Scope: https://api.businesscentral.dynamics.com/.default
```

### API Base URL

```
https://api.businesscentral.dynamics.com/v2.0/{tenant}/Production/ODataV4/
```

### Supported Entities

- `customers` - Customer records
- `vendors` - Vendor records
- `items` - Inventory items
- `salesOrders` - Sales orders
- `purchaseOrders` - Purchase orders

### OData Query Options

BCClient supports standard OData v4 query options:

- `$filter` - Filter results
- `$select` - Choose fields to return
- `$expand` - Include related entities
- `$orderby` - Sort results
- `$top` - Limit number of results
- `$skip` - Skip results (pagination)
- `$count` - Include total count

**Example**:
```typescript
const customers = await bcClient.query('customers', {
  filter: "blocked eq '' and balance gt 0",
  select: ['id', 'displayName', 'balance'],
  orderby: 'balance desc',
  top: 20,
  count: true,
});

console.log('Total customers:', customers['@odata.count']);
console.log('Returned:', customers.value.length);
```

## Error Handling

### OAuth Errors

```typescript
import { getBCClient } from '@/services/bc';

const bcClient = getBCClient();

try {
  await bcClient.validateCredentials();
} catch (error) {
  console.error('OAuth failed:', error);
  // Check: BC_CLIENT_SECRET in Key Vault
  // Check: App registration in Azure AD
  // Check: API permissions granted
}
```

### API Errors

```typescript
try {
  await bcClient.create('customers', invalidData);
} catch (error) {
  console.error('BC API error:', error);
  // Error includes BC error code and message
  // Example: "BC API Error [400]: Customer with this email already exists"
}
```

### Validation Errors

```typescript
const result = validator.validateCustomer(data);

if (!result.valid) {
  // Return 400 Bad Request with validation errors
  return res.status(400).json({
    error: 'Validation failed',
    details: result.errors,
  });
}
```

## Environment Configuration

Required environment variables:

```bash
BC_API_URL=https://api.businesscentral.dynamics.com/v2.0/...
BC_TENANT_ID=1e9a7510-b103-463a-9ade-68951205e7bc
BC_CLIENT_ID=99bdec72-7de1-4744-8fa1-afd49e1ef993
BC_CLIENT_SECRET=<from-key-vault>
```

These are loaded from Azure Key Vault in production or `.env` in development.

## Testing

### Test BC Authentication

```bash
npx ts-node src/services/bc/testBCAuthentication.ts
```

This script tests:
- OAuth token acquisition
- Token caching
- Simple query execution
- Error handling

## Best Practices

### 1. Always Use Singleton

```typescript
// ✅ Good - Reuses connection and token
import { getBCClient, getBCValidator } from '@/services/bc';
const client = getBCClient();

// ❌ Bad - Creates multiple instances
import { BCClient } from '@/services/bc';
const client1 = new BCClient();
const client2 = new BCClient(); // Duplicate auth!
```

### 2. Validate Before Creating

```typescript
// ✅ Good - Validate first
const validator = getBCValidator();
const result = validator.validateCustomer(data);

if (!result.valid) {
  return res.status(400).json({ errors: result.errors });
}

const customer = await bcClient.create('customers', data);
```

### 3. Handle Errors Gracefully

```typescript
// ✅ Good - Catch and log errors
try {
  const customers = await bcClient.query('customers');
  return res.json(customers);
} catch (error) {
  console.error('[API] BC query failed:', error);
  return res.status(500).json({ error: 'Failed to fetch customers' });
}
```

### 4. Use OData Wisely

```typescript
// ✅ Good - Select only needed fields
const customers = await bcClient.query('customers', {
  select: ['id', 'displayName', 'email'],
  top: 50,
});

// ❌ Bad - Fetches all fields, all records
const customers = await bcClient.query('customers');
```

## References

- [BC Integration Overview](../../../docs/04-integrations/02-bc-integration.md)
- [BC Entities](../../../docs/04-integrations/05-bc-entities.md)
- [MCP Overview](../../../docs/04-integrations/01-mcp-overview.md)
