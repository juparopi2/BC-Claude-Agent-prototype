/**
 * TriStateSelection Tests (PRD-112)
 *
 * Pure logic tests for the tri-state selection system used in ConnectionWizard.
 * Tests getEffectiveCheckState computation without React rendering.
 */

import { describe, it, expect } from 'vitest';

// ============================================
// Replicate the pure logic from ConnectionWizard
// ============================================

type ExplicitSelection = 'include' | 'exclude';
const SYNC_ALL_KEY = '__ROOT__';

interface SimpleNode {
  id: string;
  parentId: string | null;
  isFolder: boolean;
  children?: SimpleNode[];
}

/**
 * Build a flat lookup map from a tree of nodes.
 */
function buildNodeMap(nodes: SimpleNode[]): Map<string, SimpleNode> {
  const map = new Map<string, SimpleNode>();
  const recurse = (list: SimpleNode[]) => {
    for (const node of list) {
      map.set(node.id, node);
      if (node.children) recurse(node.children);
    }
  };
  recurse(nodes);
  return map;
}

/**
 * Compute effective check state — mirrors the logic in ConnectionWizard.
 */
function getEffectiveCheckState(
  itemId: string,
  explicitSelections: Map<string, ExplicitSelection>,
  nodeMap: Map<string, SimpleNode>
): boolean | 'indeterminate' {
  const explicit = explicitSelections.get(itemId);

  if (explicit === 'exclude') return false;

  if (explicit === 'include') {
    const node = nodeMap.get(itemId);
    if (node?.isFolder && node.children && node.children.length > 0) {
      const hasExcluded = node.children.some(
        (c) => explicitSelections.get(c.id) === 'exclude'
      );
      if (hasExcluded) return 'indeterminate';
    }
    return true;
  }

  // Inherit from parent
  const node = nodeMap.get(itemId);
  if (node?.parentId) {
    const parentState = getEffectiveCheckState(node.parentId, explicitSelections, nodeMap);
    if (parentState === true || parentState === 'indeterminate') return true;
  }

  // Sync All
  if (explicitSelections.get(SYNC_ALL_KEY) === 'include') return true;

  return false;
}

// ============================================
// Test fixtures
// ============================================

/**
 * Tree:
 * - Documents (folder)
 *   - report.pdf (file)
 *   - budget.xlsx (file)
 *   - Subfolder (folder)
 *     - notes.txt (file)
 * - Images (folder)
 *   - photo.jpg (file)
 * - readme.md (file, root level)
 */
function createTestTree(): SimpleNode[] {
  const notesTxt: SimpleNode = { id: 'notes', parentId: 'subfolder', isFolder: false };
  const subfolder: SimpleNode = { id: 'subfolder', parentId: 'docs', isFolder: true, children: [notesTxt] };
  const reportPdf: SimpleNode = { id: 'report', parentId: 'docs', isFolder: false };
  const budgetXlsx: SimpleNode = { id: 'budget', parentId: 'docs', isFolder: false };
  const docsFolder: SimpleNode = { id: 'docs', parentId: null, isFolder: true, children: [reportPdf, budgetXlsx, subfolder] };

  const photoJpg: SimpleNode = { id: 'photo', parentId: 'images', isFolder: false };
  const imagesFolder: SimpleNode = { id: 'images', parentId: null, isFolder: true, children: [photoJpg] };

  const readmeMd: SimpleNode = { id: 'readme', parentId: null, isFolder: false };

  return [docsFolder, imagesFolder, readmeMd];
}

// ============================================
// Tests
// ============================================

describe('PRD-112: Tri-State Selection Logic', () => {
  const tree = createTestTree();
  const nodeMap = buildNodeMap(tree);

  describe('Basic selection', () => {
    it('should return false for unselected item with no parent', () => {
      const selections = new Map<string, ExplicitSelection>();
      expect(getEffectiveCheckState('readme', selections, nodeMap)).toBe(false);
    });

    it('should return true for explicitly included item', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      expect(getEffectiveCheckState('docs', selections, nodeMap)).toBe(true);
    });

    it('should return false for explicitly excluded item', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'exclude']]);
      expect(getEffectiveCheckState('docs', selections, nodeMap)).toBe(false);
    });
  });

  describe('Cascading selection (check folder => children inherit)', () => {
    it('should inherit checked state from parent folder', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      expect(getEffectiveCheckState('report', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('budget', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('subfolder', selections, nodeMap)).toBe(true);
    });

    it('should inherit through nested folders', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      // notes is child of subfolder which is child of docs
      expect(getEffectiveCheckState('notes', selections, nodeMap)).toBe(true);
    });

    it('should NOT inherit across unrelated folders', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      expect(getEffectiveCheckState('photo', selections, nodeMap)).toBe(false);
      expect(getEffectiveCheckState('images', selections, nodeMap)).toBe(false);
    });
  });

  describe('Indeterminate state (uncheck child in checked folder)', () => {
    it('should show indeterminate when child is excluded', () => {
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);
      expect(getEffectiveCheckState('docs', selections, nodeMap)).toBe('indeterminate');
    });

    it('excluded child should show false', () => {
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);
      expect(getEffectiveCheckState('report', selections, nodeMap)).toBe(false);
    });

    it('non-excluded siblings should still inherit checked', () => {
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);
      expect(getEffectiveCheckState('budget', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('subfolder', selections, nodeMap)).toBe(true);
    });
  });

  describe('Sync All', () => {
    it('should check all items when Sync All is active', () => {
      const selections = new Map<string, ExplicitSelection>([[SYNC_ALL_KEY, 'include']]);
      expect(getEffectiveCheckState('docs', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('report', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('images', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('photo', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('readme', selections, nodeMap)).toBe(true);
    });

    it('should allow exclusions within Sync All', () => {
      const selections = new Map<string, ExplicitSelection>([
        [SYNC_ALL_KEY, 'include'],
        ['report', 'exclude'],
      ]);
      expect(getEffectiveCheckState('report', selections, nodeMap)).toBe(false);
      expect(getEffectiveCheckState('budget', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('readme', selections, nodeMap)).toBe(true);
    });

    it('should return false for all items when Sync All is toggled off', () => {
      const selections = new Map<string, ExplicitSelection>(); // empty = toggled off
      expect(getEffectiveCheckState('docs', selections, nodeMap)).toBe(false);
      expect(getEffectiveCheckState('report', selections, nodeMap)).toBe(false);
      expect(getEffectiveCheckState('readme', selections, nodeMap)).toBe(false);
    });
  });

  describe('Wizard reopen state reconstruction', () => {
    it('should reconstruct correct state from existing scopes', () => {
      // Simulates what happens when wizard reopens with existing include + exclude scopes
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);

      expect(getEffectiveCheckState('docs', selections, nodeMap)).toBe('indeterminate');
      expect(getEffectiveCheckState('report', selections, nodeMap)).toBe(false);
      expect(getEffectiveCheckState('budget', selections, nodeMap)).toBe(true);
    });

    it('should reconstruct Sync All state', () => {
      const selections = new Map<string, ExplicitSelection>([
        [SYNC_ALL_KEY, 'include'],
        ['report', 'exclude'],
        ['photo', 'exclude'],
      ]);

      expect(getEffectiveCheckState('docs', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('report', selections, nodeMap)).toBe(false);
      expect(getEffectiveCheckState('images', selections, nodeMap)).toBe(true);
      expect(getEffectiveCheckState('photo', selections, nodeMap)).toBe(false);
      expect(getEffectiveCheckState('readme', selections, nodeMap)).toBe(true);
    });
  });
});
