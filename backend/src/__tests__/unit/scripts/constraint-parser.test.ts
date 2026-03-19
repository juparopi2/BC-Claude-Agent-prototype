import { describe, it, expect } from 'vitest';
import {
  normalizeSql,
  parseCheckConstraints,
  parseFilteredIndexes,
  compareCheckConstraints,
  compareFilteredIndexes,
  buildVerificationResult,
} from '../../../../scripts/database/_lib/constraint-parser';

describe('constraint-parser', () => {
  describe('normalizeSql', () => {
    it('collapses whitespace', () => {
      expect(normalizeSql('a   b    c')).toBe('a b c');
    });

    it('removes [dbo]. prefix', () => {
      expect(normalizeSql('[dbo].[messages]')).toBe('messages');
    });

    it('removes square brackets', () => {
      expect(normalizeSql("[role] IN ('user')")).toBe("role in ('user')");
    });

    it('normalizes parenthesis spacing', () => {
      expect(normalizeSql('( a , b )')).toBe('(a , b)');
    });

    it('lowercases', () => {
      expect(normalizeSql('CHECK IN SELECT')).toBe('check in select');
    });
  });

  describe('parseCheckConstraints', () => {
    it('parses single constraint', () => {
      const sql = `
        ALTER TABLE [dbo].[users] ADD CONSTRAINT [chk_users_role]
          CHECK ([role] IN ('admin','editor','viewer'));
      `;
      const result = parseCheckConstraints(sql);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        name: 'chk_users_role',
        table: 'users',
      }));
      expect(result[0].definition).toContain("'admin'");
    });

    it('parses multiple constraints', () => {
      const sql = `
        ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_role]
          CHECK ([role] IN ('user','assistant'));

        ALTER TABLE [dbo].[messages] ADD CONSTRAINT [chk_messages_type]
          CHECK ([message_type] IN ('text','thinking'));
      `;
      const result = parseCheckConstraints(sql);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('chk_messages_role');
      expect(result[1].name).toBe('chk_messages_type');
    });

    it('skips non-constraint SQL', () => {
      const sql = `
        CREATE TABLE [dbo].[users] (id INT);
        -- ALTER TABLE [dbo].[users] ADD CONSTRAINT [old] CHECK ([x] IN ('a'));
      `;
      const result = parseCheckConstraints(sql);
      expect(result).toHaveLength(0);
    });

    it('handles multiline CHECK definitions', () => {
      const sql = `
        ALTER TABLE [dbo].[message_events] ADD CONSTRAINT [CK_message_events_valid_type]
          CHECK ([event_type] IN ('user_message_sent','agent_thinking_started',
            'agent_thinking_completed','agent_thinking_block'));
      `;
      const result = parseCheckConstraints(sql);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('CK_message_events_valid_type');
    });
  });

  describe('parseFilteredIndexes', () => {
    it('parses filtered unique index', () => {
      const sql = `
        CREATE UNIQUE NONCLUSTERED INDEX [UQ_files_connection_external]
          ON [dbo].[files] ([connection_id], [external_id])
          WHERE [connection_id] IS NOT NULL AND [external_id] IS NOT NULL;
      `;
      const result = parseFilteredIndexes(sql);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(expect.objectContaining({
        name: 'UQ_files_connection_external',
        table: 'files',
        columns: ['connection_id', 'external_id'],
      }));
      expect(result[0].filter).toContain('is not null');
    });

    it('returns empty for non-filtered indexes', () => {
      const sql = `
        CREATE NONCLUSTERED INDEX [idx_users_email] ON [dbo].[users]([email]);
      `;
      const result = parseFilteredIndexes(sql);
      expect(result).toHaveLength(0);
    });
  });

  describe('compareCheckConstraints', () => {
    it('detects no drift when matching', () => {
      const expected = [{
        name: 'chk_users_role',
        table: 'users',
        definition: normalizeSql("[role] IN ('admin','editor','viewer')"),
      }];
      const actual = [{
        name: 'chk_users_role',
        table: 'users',
        definition: "([role] IN ('admin','editor','viewer'))",
      }];
      const result = compareCheckConstraints(expected, actual);
      expect(result.missing).toHaveLength(0);
      expect(result.extra).toHaveLength(0);
      expect(result.mismatched).toHaveLength(0);
    });

    it('detects missing constraint', () => {
      const expected = [{
        name: 'chk_new',
        table: 'users',
        definition: normalizeSql("[x] IN ('a')"),
      }];
      const result = compareCheckConstraints(expected, []);
      expect(result.missing).toEqual(['users.chk_new']);
    });

    it('detects extra constraint', () => {
      const actual = [{
        name: 'chk_old',
        table: 'users',
        definition: "([x] IN ('a'))",
      }];
      const result = compareCheckConstraints([], actual);
      expect(result.extra).toEqual(['users.chk_old']);
    });

    it('detects mismatched definition', () => {
      const expected = [{
        name: 'chk_users_role',
        table: 'users',
        definition: normalizeSql("[role] IN ('admin','editor','viewer')"),
      }];
      const actual = [{
        name: 'chk_users_role',
        table: 'users',
        definition: "([role] IN ('admin','editor'))",
      }];
      const result = compareCheckConstraints(expected, actual);
      expect(result.mismatched).toHaveLength(1);
      expect(result.mismatched[0].name).toBe('users.chk_users_role');
    });

    it('compares case-insensitively on names', () => {
      const expected = [{
        name: 'CK_Connections_Provider',
        table: 'connections',
        definition: normalizeSql("[provider] IN ('a')"),
      }];
      const actual = [{
        name: 'ck_connections_provider',
        table: 'connections',
        definition: "([provider] IN ('a'))",
      }];
      const result = compareCheckConstraints(expected, actual);
      expect(result.missing).toHaveLength(0);
    });
  });

  describe('buildVerificationResult', () => {
    it('returns isClean=true when no drift', () => {
      const clean = { missing: [], extra: [], mismatched: [] };
      const result = buildVerificationResult(clean, clean);
      expect(result.isClean).toBe(true);
    });

    it('returns isClean=false when drift exists', () => {
      const drift = { missing: ['x'], extra: [], mismatched: [] };
      const clean = { missing: [], extra: [], mismatched: [] };
      const result = buildVerificationResult(drift, clean);
      expect(result.isClean).toBe(false);
    });
  });
});
