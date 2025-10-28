# Business Central Authentication

OAuth 2.0 client credentials flow.

```typescript
const token = await getAccessToken({
  tenantId: process.env.BC_TENANT_ID,
  clientId: process.env.BC_CLIENT_ID,
  clientSecret: process.env.BC_CLIENT_SECRET
});
```
