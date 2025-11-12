# External Tools Integration

## File System Tools

```typescript
const fileTools = [
  {
    name: 'read_file',
    description: 'Read file contents',
    handler: async (path: string) => {
      return await fs.promises.readFile(path, 'utf-8');
    }
  },
  {
    name: 'write_file',
    description: 'Write to file',
    handler: async (path: string, content: string) => {
      await fs.promises.writeFile(path, content);
    }
  }
];
```

## Code Execution (Sandboxed)

```typescript
const codeTools = [
  {
    name: 'execute_python',
    description: 'Execute Python code in sandbox',
    handler: async (code: string) => {
      return await pythonSandbox.execute(code);
    }
  }
];
```

## External APIs (Optional)

- **Email**: SendGrid, AWS SES
- **SMS**: Twilio
- **Web Search**: SerpAPI
- **Document Generation**: Puppeteer, PDFKit

---

**Versión**: 1.0
