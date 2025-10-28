# Infrastructure Deployment

Este directorio contiene scripts e instrucciones para desplegar la infraestructura de Azure necesaria para BC-Claude-Agent-Prototype.

## Recursos de Azure

### Resource Groups (ya existentes)
- `rg-BCAgentPrototype-app-dev` - Aplicaciones y servicios
- `rg-BCAgentPrototype-data-dev` - Bases de datos y almacenamiento
- `rg-BCAgentPrototype-sec-dev` - Seguridad e identidades

### Recursos que se crearán

#### Security (rg-BCAgentPrototype-sec-dev)
- **Key Vault**: `kv-bcagent-dev` - Almacenamiento seguro de secrets
- **Managed Identity (Backend)**: `mi-bcagent-backend-dev` - Identidad para el backend
- **Managed Identity (Frontend)**: `mi-bcagent-frontend-dev` - Identidad para el frontend

#### Data (rg-BCAgentPrototype-data-dev)
- **SQL Server**: `sqlsrv-bcagent-dev` - Servidor de base de datos
- **SQL Database**: `sqldb-bcagent-dev` - Base de datos principal
- **Redis Cache**: `redis-bcagent-dev` - Caché y sesiones
- **Storage Account**: `sabcagentdev` - Almacenamiento de archivos

#### Application (rg-BCAgentPrototype-app-dev)
- **Container Registry**: `crbcagentdev` - Registro de imágenes Docker
- **Container Apps Environment**: `cae-bcagent-dev` - Entorno para Container Apps
- **Backend App**: `app-bcagent-backend-dev` - Aplicación backend
- **Frontend App**: `app-bcagent-frontend-dev` - Aplicación frontend

## Prerequisitos

1. Azure CLI instalado y configurado
2. Permisos de Contributor en la suscripción `5343f6e1-f251-4b50-a592-18ff3e97eaa7`
3. OpenSSL instalado (para generar JWT secret)

## Deployment

### Paso 1: Ejecutar el script de deployment

```bash
# Hacer el script ejecutable (en Linux/Mac)
chmod +x deploy-azure-resources.sh

# Ejecutar el script
./deploy-azure-resources.sh
```

En Windows (usando Git Bash o WSL):
```bash
bash deploy-azure-resources.sh
```

El script te pedirá:
- **SQL Server admin password**: Debe cumplir con requisitos de complejidad (mínimo 8 caracteres, mayúsculas, minúsculas, números y caracteres especiales)

### Paso 2: Agregar Claude API Key

Después de que el script termine, agrega tu Claude API key manualmente:

```bash
az keyvault secret set \
  --vault-name kv-bcagent-dev \
  --name "Claude-ApiKey" \
  --value "sk-ant-YOUR_API_KEY_HERE"
```

### Paso 3: Verificar los recursos

```bash
# Listar recursos en cada RG
az resource list --resource-group rg-BCAgentPrototype-app-dev --output table
az resource list --resource-group rg-BCAgentPrototype-data-dev --output table
az resource list --resource-group rg-BCAgentPrototype-sec-dev --output table
```

## Secrets en Key Vault

Los siguientes secrets se configuran automáticamente:

| Secret Name | Description |
|-------------|-------------|
| `BC-TenantId` | Business Central Tenant ID |
| `BC-ClientId` | Business Central Client ID |
| `BC-ClientSecret` | Business Central Client Secret |
| `JWT-Secret` | Secret para JWT tokens (generado automáticamente) |
| `SqlDb-ConnectionString` | Connection string de Azure SQL |
| `Redis-ConnectionString` | Connection string de Redis |
| `Storage-ConnectionString` | Connection string de Storage Account |
| `Claude-ApiKey` | **MANUAL**: Tu API key de Anthropic Claude |

## Acceder a los secrets

### Desde Azure CLI
```bash
az keyvault secret show --vault-name kv-bcagent-dev --name "BC-TenantId" --query value -o tsv
```

### Desde el código (con Managed Identity)
Las aplicaciones backend y frontend usan sus Managed Identities para acceder al Key Vault automáticamente.

## Costos Estimados (por mes)

Basado en el tier seleccionado:

- **Key Vault**: ~$0.03/10,000 operations
- **SQL Database (S0)**: ~$15/month
- **Redis (Basic C0)**: ~$16/month
- **Storage Account (LRS)**: ~$0.02/GB
- **Container Registry (Basic)**: ~$5/month
- **Container Apps**: ~$0.000012/vCore-second + $0.000002/GiB-second
- **Managed Identities**: Free

**Total estimado**: ~$40-60/month (sin contar Container Apps usage)

## Troubleshooting

### Error: Key Vault name already exists
Si el nombre del Key Vault ya está en uso, puedes:
1. Cambiar el nombre en el script
2. Recuperar el Key Vault eliminado: `az keyvault recover --name kv-bcagent-dev`

### Error: SQL Server name already exists
Cambia el nombre del SQL Server en el script o usa uno existente.

### Error: Redis creation timeout
Redis puede tardar 10-15 minutos en crearse. Espera y verifica con:
```bash
az redis show --name redis-bcagent-dev --resource-group rg-BCAgentPrototype-data-dev
```

## Limpieza de Recursos

Para eliminar todos los recursos creados:

```bash
# ADVERTENCIA: Esto eliminará TODOS los recursos y datos
az resource list --resource-group rg-BCAgentPrototype-app-dev --query "[].id" -o tsv | xargs -I {} az resource delete --ids {}
az resource list --resource-group rg-BCAgentPrototype-data-dev --query "[].id" -o tsv | xargs -I {} az resource delete --ids {}
az resource list --resource-group rg-BCAgentPrototype-sec-dev --query "[].id" -o tsv | xargs -I {} az resource delete --ids {}
```

## Next Steps

Después de crear la infraestructura:

1. ✅ Inicializar el database schema (`backend/scripts/init-db.sql`)
2. ✅ Configurar el proyecto backend
3. ✅ Configurar el proyecto frontend
4. ✅ Build y deploy de las aplicaciones

Ver el [Development Setup Guide](../docs/12-development/01-setup-guide.md) para más detalles.
