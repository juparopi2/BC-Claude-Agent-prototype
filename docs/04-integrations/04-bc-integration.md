# Business Central Integration

## Authentication

```typescript
// OAuth 2.0 con Business Central
const bcAuth = {
  tenantId: process.env.BC_TENANT_ID,
  clientId: process.env.BC_CLIENT_ID,
  clientSecret: process.env.BC_CLIENT_SECRET,
  scope: 'https://api.businesscentral.dynamics.com/.default'
};

async function getAccessToken() {
  const response = await fetch(
    `https://login.microsoftonline.com/${bcAuth.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        client_id: bcAuth.clientId,
        client_secret: bcAuth.clientSecret,
        scope: bcAuth.scope,
        grant_type: 'client_credentials'
      })
    }
  );
  return (await response.json()).access_token;
}
```

## API Endpoints

### OData v4 API
- Base URL: `https://api.businesscentral.dynamics.com/v2.0/{tenant}/api/v2.0`
- Used for: Queries, filters, expansions

### REST API  
- Used for: Actions, functions, custom endpoints

## Common Operations

```typescript
// Query customers
GET /companies({id})/customers?$filter=blocked eq false&$top=50

// Create sales order
POST /companies({id})/salesOrders
{
  "customerId": "...",
  "orderDate": "2025-10-28",
  "salesOrderLines": [...]
}

// Update item
PATCH /companies({id})/items({itemId})
{
  "unitPrice": 99.99
}

// Delete
DELETE /companies({id})/customers({customerId})
```

---

**Versión**: 1.0
