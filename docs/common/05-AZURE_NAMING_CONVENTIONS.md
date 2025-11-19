# Azure Naming Conventions

This is a guideline on how to name resources in Azure. This is inspired by the best practice guide from Microsoft on how to define and name your resources: [Microsoft - Define your naming convention](https://learn.microsoft.com/en-us/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming).

Use this guideline when possible. There may be some auto-created sub-resources by Microsoft where we can't control the naming.

## Naming Elements

| Element | Explanation |
| :--- | :--- |
| **Resource Type** | Follow the guide from Microsoft. The ones we commonly use are listed below. |
| **Workload/Application** | The name of the app/project (e.g., `mybikeguard`). |
| **Environment** | We work with 3 main environments: development, test, and production (`dev`, `test`, `prod`). |
| **Azure Region** | Since we work in West Europe for 99% of resources, we only specify this if it's not in West Europe. |
| **Instance** | It's very rare we will need to have more than one, so we will not specify this unless we need to. |

## Resource Type Abbreviations

We use the naming conventions defined by Microsoft, but since it does not cover all, we maintain our own list.

| Resource type | Short name |
| :--- | :--- |
| Azure SQL Server | `sqlsrv` |
| SQL Elastic database pool | `sqlpool` |
| SQL Database | `sqldb` |
| Logic app | `la` |
| Resource group | `rg` |
| Managed identity | `id` |
| Virtual network | `vnet` |
| Subnet | `snet` |
| Public IP address | `pip` |
| Network security group | `nsg` |
| Virtual network gateway | `vgw` |
| VPN connection | `vcn` |
| Virtual machine | `vm` |
| Web app | `app` |
| Function app | `func` |
| App Service Plan | `asp` |
| Cognitive Services | `cog` |
| Container registry | `cr` |
| Storage account | `sa` |
| Application Insights | `ai` |
| Managed Identity | `mi` |
| Translator | `t` |
| Speech Service | `ss` |
| Log Analytics workspace | `law` |
| Azure Cache for redis | `acr` |
| Azure OpenAI | `openai` |


## Resource Groups

We use resource groups to control access to specific areas. It's also useful if we need to grant access to external developers or technicians.

All resources share the same virtual network due to VPN connections and costs of virtual gateways.

`xxx` is replaced with the workload/application (e.g., `mybikeguard`).

| Area/Environment | Development | Test | Production |
| :--- | :--- | :--- | :--- |
| **Network** | `rg-pmc-soft-network` | `rg-pmc-soft-network` | `rg-pmc-soft-network` |
| **App** (logic app, app service, functions) | `rg-xxx-app-dev` | `rg-xxx-app-test` | `rg-xxx-app-prod` |
| **Data** (sql databases, file and data shares) | `rg-xxx-data-dev` | `rg-xxx-data-test` | `rg-xxx-data-prod` |
| **Sec** (managed identities) | `rg-xxx-sec-dev` | `rg-xxx-sec-test` | `rg-xxx-sec-prog` |

## Project Specific Configuration: Personal Assistant MVP

For this specific project, the following resources will be created:

* **Subscription ID**: `5343f6e1-f251-4b50-a592-18ff3e97eaa7`
* **Application Resource Group**: `rg-BCAgentPrototype-app-dev`
* **Data Resource Group**: `rg-BCAgentPrototype-data-dev`
* **Security Resource Group**: `rg-BCAgentPrototype-sec-dev`
