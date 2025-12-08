/**
 * MockResponseLibrary Verification Tests
 */

import { describe, it, expect } from 'vitest';
import {
  MockResponses,
  getRandomResponse,
  getResponseById,
  getCategoryResponseIds,
  createCustomResponse,
  listCategories,
  listAllResponses,
  getResponsesByStopReason,
  getResponsesWithThinking,
  getResponsesWithToolUse
} from '@services/agent/MockResponseLibrary';

describe('MockResponseLibrary', () => {
  describe('Template Structure', () => {
    it('should have all 6 categories', () => {
      const categories = Object.keys(MockResponses);
      expect(categories).toHaveLength(6);
      expect(categories).toContain('greetings');
      expect(categories).toContain('businessCentral');
      expect(categories).toContain('toolUse');
      expect(categories).toContain('searchResults');
      expect(categories).toContain('complexExplanations');
      expect(categories).toContain('errors');
    });

    it('should have total of 22 templates', () => {
      const totalTemplates = Object.values(MockResponses).reduce(
        (sum, category) => sum + Object.keys(category).length,
        0
      );
      expect(totalTemplates).toBe(22);
    });

    it('all templates should follow interface', () => {
      for (const category of Object.values(MockResponses)) {
        for (const template of Object.values(category)) {
          expect(template).toHaveProperty('id');
          expect(template).toHaveProperty('description');
          expect(template).toHaveProperty('text');
          expect(template).toHaveProperty('stopReason');
        }
      }
    });

    it('all template IDs should be unique', () => {
      const allIds: string[] = [];
      for (const category of Object.values(MockResponses)) {
        for (const template of Object.values(category)) {
          allIds.push(template.id);
        }
      }
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  describe('Helper Functions', () => {
    it('getRandomResponse works', () => {
      const response = getRandomResponse('greetings');
      expect(response).toBeDefined();
      expect(response.id).toMatch(/^greeting-/);
    });

    it('getResponseById works', () => {
      const response = getResponseById('greeting-simple');
      expect(response).toBeDefined();
      expect(response?.id).toBe('greeting-simple');
    });

    it('getCategoryResponseIds works', () => {
      const ids = getCategoryResponseIds('greetings');
      expect(ids).toHaveLength(3);
    });

    it('listCategories works', () => {
      const categories = listCategories();
      expect(categories).toHaveLength(6);
    });

    it('listAllResponses works', () => {
      const responses = listAllResponses();
      expect(responses).toHaveLength(22);
    });

    it('getResponsesByStopReason works', () => {
      const responses = getResponsesByStopReason('tool_use');
      expect(responses).toHaveLength(5);
    });

    it('getResponsesWithThinking works', () => {
      const responses = getResponsesWithThinking();
      expect(responses.length).toBeGreaterThan(0);
    });

    it('getResponsesWithToolUse works', () => {
      const responses = getResponsesWithToolUse();
      expect(responses).toHaveLength(5);
    });

    it('createCustomResponse works', () => {
      const response = createCustomResponse('Test');
      expect(response.text).toBe('Test');
      expect(response.stopReason).toBe('end_turn');
    });
  });
});
