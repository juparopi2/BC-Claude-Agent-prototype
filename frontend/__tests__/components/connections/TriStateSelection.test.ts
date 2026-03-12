/**
 * TriStateSelection Tests (PRD-112 / PRD-115)
 *
 * Pure logic tests for the tri-state selection system used in both
 * ConnectionWizard (OneDrive) and SharePointWizard.
 * Tests getEffectiveCheckState computation without React rendering.
 */

import { describe, it, expect } from 'vitest';
import {
  type ExplicitSelection,
  type NodeInfo,
  SYNC_ALL_KEY,
  getEffectiveCheckState,
} from '@/components/connections/wizard-utils';

// ============================================
// Test fixtures - adapted to NodeInfo via findNode callback
// ============================================

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
 * Adapter: convert SimpleNode map to a findNode callback returning NodeInfo.
 */
function makeFindNode(nodeMap: Map<string, SimpleNode>): (id: string) => NodeInfo | null {
  return (id: string) => {
    const node = nodeMap.get(id);
    if (!node) return null;
    return {
      id: node.id,
      parentId: node.parentId,
      isFolder: node.isFolder,
      childIds: node.children?.map(c => c.id) ?? [],
    };
  };
}

/**
 * Helper: call getEffectiveCheckState with SimpleNode-based fixtures.
 */
function checkState(
  itemId: string,
  explicitSelections: Map<string, ExplicitSelection>,
  nodeMap: Map<string, SimpleNode>
): boolean | 'indeterminate' {
  const isSyncAll = explicitSelections.get(SYNC_ALL_KEY) === 'include';
  return getEffectiveCheckState(itemId, explicitSelections, makeFindNode(nodeMap), isSyncAll);
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
      expect(checkState('readme', selections, nodeMap)).toBe(false);
    });

    it('should return true for explicitly included item', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      expect(checkState('docs', selections, nodeMap)).toBe(true);
    });

    it('should return false for explicitly excluded item', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'exclude']]);
      expect(checkState('docs', selections, nodeMap)).toBe(false);
    });
  });

  describe('Cascading selection (check folder => children inherit)', () => {
    it('should inherit checked state from parent folder', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      expect(checkState('report', selections, nodeMap)).toBe(true);
      expect(checkState('budget', selections, nodeMap)).toBe(true);
      expect(checkState('subfolder', selections, nodeMap)).toBe(true);
    });

    it('should inherit through nested folders', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      // notes is child of subfolder which is child of docs
      expect(checkState('notes', selections, nodeMap)).toBe(true);
    });

    it('should NOT inherit across unrelated folders', () => {
      const selections = new Map<string, ExplicitSelection>([['docs', 'include']]);
      expect(checkState('photo', selections, nodeMap)).toBe(false);
      expect(checkState('images', selections, nodeMap)).toBe(false);
    });
  });

  describe('Indeterminate state (uncheck child in checked folder)', () => {
    it('should show indeterminate when child is excluded', () => {
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);
      expect(checkState('docs', selections, nodeMap)).toBe('indeterminate');
    });

    it('excluded child should show false', () => {
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);
      expect(checkState('report', selections, nodeMap)).toBe(false);
    });

    it('non-excluded siblings should still inherit checked', () => {
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);
      expect(checkState('budget', selections, nodeMap)).toBe(true);
      expect(checkState('subfolder', selections, nodeMap)).toBe(true);
    });
  });

  describe('Sync All', () => {
    it('should check all items when Sync All is active', () => {
      const selections = new Map<string, ExplicitSelection>([[SYNC_ALL_KEY, 'include']]);
      expect(checkState('docs', selections, nodeMap)).toBe(true);
      expect(checkState('report', selections, nodeMap)).toBe(true);
      expect(checkState('images', selections, nodeMap)).toBe(true);
      expect(checkState('photo', selections, nodeMap)).toBe(true);
      expect(checkState('readme', selections, nodeMap)).toBe(true);
    });

    it('should allow exclusions within Sync All', () => {
      const selections = new Map<string, ExplicitSelection>([
        [SYNC_ALL_KEY, 'include'],
        ['report', 'exclude'],
      ]);
      expect(checkState('report', selections, nodeMap)).toBe(false);
      expect(checkState('budget', selections, nodeMap)).toBe(true);
      expect(checkState('readme', selections, nodeMap)).toBe(true);
    });

    it('should return false for all items when Sync All is toggled off', () => {
      const selections = new Map<string, ExplicitSelection>(); // empty = toggled off
      expect(checkState('docs', selections, nodeMap)).toBe(false);
      expect(checkState('report', selections, nodeMap)).toBe(false);
      expect(checkState('readme', selections, nodeMap)).toBe(false);
    });
  });

  describe('Wizard reopen state reconstruction', () => {
    it('should reconstruct correct state from existing scopes', () => {
      // Simulates what happens when wizard reopens with existing include + exclude scopes
      const selections = new Map<string, ExplicitSelection>([
        ['docs', 'include'],
        ['report', 'exclude'],
      ]);

      expect(checkState('docs', selections, nodeMap)).toBe('indeterminate');
      expect(checkState('report', selections, nodeMap)).toBe(false);
      expect(checkState('budget', selections, nodeMap)).toBe(true);
    });

    it('should reconstruct Sync All state', () => {
      const selections = new Map<string, ExplicitSelection>([
        [SYNC_ALL_KEY, 'include'],
        ['report', 'exclude'],
        ['photo', 'exclude'],
      ]);

      expect(checkState('docs', selections, nodeMap)).toBe(true);
      expect(checkState('report', selections, nodeMap)).toBe(false);
      expect(checkState('images', selections, nodeMap)).toBe(true);
      expect(checkState('photo', selections, nodeMap)).toBe(false);
      expect(checkState('readme', selections, nodeMap)).toBe(true);
    });
  });
});

describe('PRD-115: SharePoint Tri-State Selection', () => {
  /**
   * SharePoint tree (libraries as roots):
   * - lib-docs (library, parentId: null)
   *   - proposals (folder, parentId: lib-docs)
   *     - draft.docx (file, parentId: proposals)
   *   - contracts (folder, parentId: lib-docs)
   * - lib-media (library, parentId: null)
   *   - images (folder, parentId: lib-media)
   */
  function createSharePointTree(): SimpleNode[] {
    const draft: SimpleNode = { id: 'draft', parentId: 'proposals', isFolder: false };
    const proposals: SimpleNode = { id: 'proposals', parentId: 'lib-docs', isFolder: true, children: [draft] };
    const contracts: SimpleNode = { id: 'contracts', parentId: 'lib-docs', isFolder: true, children: [] };
    const libDocs: SimpleNode = { id: 'lib-docs', parentId: null, isFolder: true, children: [proposals, contracts] };

    const images: SimpleNode = { id: 'images', parentId: 'lib-media', isFolder: true, children: [] };
    const libMedia: SimpleNode = { id: 'lib-media', parentId: null, isFolder: true, children: [images] };

    return [libDocs, libMedia];
  }

  const spTree = createSharePointTree();
  const spNodeMap = buildNodeMap(spTree);

  it('should inherit checked state from library to child folders', () => {
    const selections = new Map<string, ExplicitSelection>([['lib-docs', 'include']]);
    expect(checkState('proposals', selections, spNodeMap)).toBe(true);
    expect(checkState('contracts', selections, spNodeMap)).toBe(true);
    expect(checkState('draft', selections, spNodeMap)).toBe(true);
  });

  it('should show indeterminate when folder is excluded within selected library', () => {
    const selections = new Map<string, ExplicitSelection>([
      ['lib-docs', 'include'],
      ['proposals', 'exclude'],
    ]);
    expect(checkState('lib-docs', selections, spNodeMap)).toBe('indeterminate');
    expect(checkState('proposals', selections, spNodeMap)).toBe(false);
    expect(checkState('contracts', selections, spNodeMap)).toBe(true);
  });

  it('should cascade from library through nested folders', () => {
    const selections = new Map<string, ExplicitSelection>([['lib-docs', 'include']]);
    // draft is child of proposals which is child of lib-docs
    expect(checkState('draft', selections, spNodeMap)).toBe(true);
  });

  it('should not inherit across libraries', () => {
    const selections = new Map<string, ExplicitSelection>([['lib-docs', 'include']]);
    expect(checkState('lib-media', selections, spNodeMap)).toBe(false);
    expect(checkState('images', selections, spNodeMap)).toBe(false);
  });

  it('should support Sync All across multiple libraries', () => {
    const selections = new Map<string, ExplicitSelection>([[SYNC_ALL_KEY, 'include']]);
    expect(checkState('lib-docs', selections, spNodeMap)).toBe(true);
    expect(checkState('lib-media', selections, spNodeMap)).toBe(true);
    expect(checkState('proposals', selections, spNodeMap)).toBe(true);
    expect(checkState('images', selections, spNodeMap)).toBe(true);
    expect(checkState('draft', selections, spNodeMap)).toBe(true);
  });

  it('should allow library exclusion within Sync All', () => {
    const selections = new Map<string, ExplicitSelection>([
      [SYNC_ALL_KEY, 'include'],
      ['lib-media', 'exclude'],
    ]);
    expect(checkState('lib-docs', selections, spNodeMap)).toBe(true);
    expect(checkState('lib-media', selections, spNodeMap)).toBe(false);
    expect(checkState('images', selections, spNodeMap)).toBe(false);
  });

  it('should allow folder exclusion within Sync All', () => {
    const selections = new Map<string, ExplicitSelection>([
      [SYNC_ALL_KEY, 'include'],
      ['proposals', 'exclude'],
    ]);
    expect(checkState('lib-docs', selections, spNodeMap)).toBe(true);
    expect(checkState('proposals', selections, spNodeMap)).toBe(false);
    expect(checkState('contracts', selections, spNodeMap)).toBe(true);
    expect(checkState('draft', selections, spNodeMap)).toBe(false);
  });

  it('should reconstruct from mixed include/exclude scopes (pre-population)', () => {
    const selections = new Map<string, ExplicitSelection>([
      ['lib-docs', 'include'],
      ['proposals', 'exclude'],
      ['lib-media', 'include'],
    ]);
    expect(checkState('lib-docs', selections, spNodeMap)).toBe('indeterminate');
    expect(checkState('proposals', selections, spNodeMap)).toBe(false);
    expect(checkState('contracts', selections, spNodeMap)).toBe(true);
    expect(checkState('lib-media', selections, spNodeMap)).toBe(true);
    expect(checkState('images', selections, spNodeMap)).toBe(true);
  });
});
