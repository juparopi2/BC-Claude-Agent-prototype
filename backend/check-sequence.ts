import sql from 'mssql';
import { getDatabaseConfig } from './src/config/database';

(async () => {
  try {
    const config = getDatabaseConfig();
    const pool = await sql.connect(config);
    // Check message_events table (EventStore - source of truth)
    const eventsResult = await pool.request()
      .input('sessionId', sql.UniqueIdentifier, 'E890A476-885F-4E3C-8E6D-3BB15CF1EB50')
      .query(`
        SELECT TOP 50
          sequence_number,
          event_type,
          timestamp
        FROM message_events
        WHERE session_id = @sessionId
        ORDER BY sequence_number;
      `);

    console.log('\n\nEventStore (message_events) - SOURCE OF TRUTH:');
    console.log('================================================');
    eventsResult.recordset.forEach(row => {
      const time = row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : 'N/A';
      console.log(`seq=${row.sequence_number} | event=${row.event_type.padEnd(30)} | time=${time}`);
    });

    // Check messages table (MessageQueue - may be out of order due to async processing)
    const result = await pool.request()
      .input('sessionId', sql.UniqueIdentifier, 'E890A476-885F-4E3C-8E6D-3BB15CF1EB50')
      .query(`
        SELECT
          sequence_number,
          message_type,
          role,
          SUBSTRING(content, 1, 50) as content_preview,
          JSON_VALUE(metadata, '$.tool_name') as tool_name,
          JSON_VALUE(metadata, '$.block_index') as block_index,
          created_at
        FROM messages
        WHERE session_id = @sessionId
        ORDER BY sequence_number;
      `);

    console.log('\nMessage Sequence for Session E890A476-885F-4E3C-8E6D-3BB15CF1EB50:');
    console.log('==================================================================');
    result.recordset.forEach(row => {
      const toolName = row.tool_name || 'N/A';
      const blockIdx = row.block_index || 'N/A';
      const preview = row.content_preview || '';
      const timestamp = row.created_at ? new Date(row.created_at).toLocaleTimeString() : 'N/A';
      console.log(`seq=${row.sequence_number} | type=${row.message_type.padEnd(12)} | tool=${toolName.padEnd(30)} | block_idx=${blockIdx} | time=${timestamp} | preview=${preview}`);
    });

    console.log('\n\nFOCUS ON Turn 2 messages (seq 6-7):');
    console.log('====================================');
    const turn2 = result.recordset.filter(r => r.sequence_number === 6 || r.sequence_number === 7);
    turn2.forEach(row => {
      console.log(JSON.stringify(row, null, 2));
    });

    await pool.close();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
