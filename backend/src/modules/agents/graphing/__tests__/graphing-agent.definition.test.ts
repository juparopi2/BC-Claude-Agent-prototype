/**
 * Graphing Agent Definition Tests
 *
 * Verifies the agent definition matches shared constants.
 */

import { describe, it, expect } from 'vitest';
import {
  AGENT_ID,
  AGENT_DISPLAY_NAME,
  AGENT_ICON,
  AGENT_COLOR,
  AGENT_DESCRIPTION,
  AGENT_CAPABILITY,
} from '@bc-agent/shared';
import { graphingAgentDefinition } from '../index';

describe('Graphing Agent Definition', () => {
  it('should have correct agent ID', () => {
    expect(graphingAgentDefinition.id).toBe(AGENT_ID.GRAPHING_AGENT);
    expect(graphingAgentDefinition.id).toBe('graphing-agent');
  });

  it('should match shared display name', () => {
    expect(graphingAgentDefinition.name).toBe(AGENT_DISPLAY_NAME[AGENT_ID.GRAPHING_AGENT]);
  });

  it('should match shared icon', () => {
    expect(graphingAgentDefinition.icon).toBe(AGENT_ICON[AGENT_ID.GRAPHING_AGENT]);
  });

  it('should match shared color', () => {
    expect(graphingAgentDefinition.color).toBe(AGENT_COLOR[AGENT_ID.GRAPHING_AGENT]);
  });

  it('should match shared description', () => {
    expect(graphingAgentDefinition.description).toBe(AGENT_DESCRIPTION[AGENT_ID.GRAPHING_AGENT]);
  });

  it('should have DATA_VIZ capability', () => {
    expect(graphingAgentDefinition.capabilities).toContain(AGENT_CAPABILITY.DATA_VIZ);
  });

  it('should have modelRole set to graphing_agent', () => {
    expect(graphingAgentDefinition.modelRole).toBe('graphing_agent');
  });

  it('should be user-selectable', () => {
    expect(graphingAgentDefinition.isUserSelectable).toBe(true);
  });

  it('should not be a system agent', () => {
    expect(graphingAgentDefinition.isSystemAgent).toBe(false);
  });

  it('should have a non-empty system prompt', () => {
    expect(graphingAgentDefinition.systemPrompt.length).toBeGreaterThan(50);
  });
});
