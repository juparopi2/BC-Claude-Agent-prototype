
import fs from 'fs';
import readline from 'readline';
import path from 'path';

/**
 * Script to extract logs for a specific session ID from a large JSON log file.
 * 
 * Usage:
 * npx tsx scripts/extract-session-logs.ts <sessionId> [logFilePath]
 * 
 * Example:
 * npx tsx scripts/extract-session-logs.ts sess_12345 logs/app.log
 */

const sessionId = process.argv[2];
const logFilePath = process.argv[3] || path.join(process.cwd(), 'logs', 'app.log');

if (!sessionId) {
  console.error('❌ Error: Session ID is required.');
  console.log('Usage: npx tsx scripts/extract-session-logs.ts <sessionId> [logFilePath]');
  process.exit(1);
}

if (!fs.existsSync(logFilePath)) {
  console.error(`❌ Error: Log file not found at ${logFilePath}`);
  process.exit(1);
}

console.log(`🔍 Searching for logs with session ID: ${sessionId}`);
console.log(`📂 Reading file: ${logFilePath}`);

const outputDir = path.join(process.cwd(), 'logs', 'sessions');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const outputFile = path.join(outputDir, `${sessionId}.log`);
const writeStream = fs.createWriteStream(outputFile);

const readStream = fs.createReadStream(logFilePath);
const rl = readline.createInterface({
  input: readStream,
  crlfDelay: Infinity,
});

let count = 0;

rl.on('line', (line) => {
  try {
    if (!line.trim()) return;
    
    // Fast check before parsing
    if (!line.includes(sessionId)) return;

    const logEntry = JSON.parse(line);
    
    // Check various places where sessionId might be stored
    const match = 
      logEntry.sessionId === sessionId ||
      logEntry.session_id === sessionId ||
      (logEntry.metadata && logEntry.metadata.sessionId === sessionId) ||
      (logEntry.msg && typeof logEntry.msg === 'string' && logEntry.msg.includes(sessionId));

    if (match) {
      writeStream.write(line + '\n');
      count++;
    }
  } catch (error) {
    // Ignore parse errors for non-JSON lines
  }
});

rl.on('close', () => {
  console.log(`✅ Extraction complete.`);
  console.log(`📊 Found ${count} log entries.`);
  console.log(`💾 Saved to: ${outputFile}`);
  writeStream.end();
});
