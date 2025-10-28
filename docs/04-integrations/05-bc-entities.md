# Business Central Entities

## Core Entities

### Customer
```json
{
  "id": "guid",
  "number": "string",
  "displayName": "string",
  "email": "string",
  "phoneNumber": "string",
  "blocked": "boolean"
}
```

### Vendor
```json
{
  "id": "guid",
  "number": "string",
  "displayName": "string",
  "balance": "decimal"
}
```

### Item (Product)
```json
{
  "id": "guid",
  "number": "string",
  "displayName": "string",
  "unitPrice": "decimal",
  "inventory": "decimal"
}
```

### Sales Order
```json
{
  "id": "guid",
  "number": "string",
  "customerId": "guid",
  "orderDate": "date",
  "totalAmount": "decimal",
  "status": "Draft|Released|..."
}
```

### Purchase Order
```json
{
  "id": "guid",
  "number": "string",
  "vendorId": "guid",
  "orderDate": "date"
}
```

## Entity Relationships

```
Customer --< Sales Order --< Sales Order Line >-- Item
Vendor --< Purchase Order --< Purchase Order Line >-- Item
```

## MCP Resource URIs

```
bc://entities/Customer
bc://entities/Vendor
bc://entities/Item
bc://entities/SalesOrder
bc://entities/PurchaseOrder
```

---

**Versión**: 1.0
