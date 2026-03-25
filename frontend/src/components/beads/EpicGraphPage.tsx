/**
 * EpicGraphPage - Full-page dependency graph for an epic.
 * Opened in a new browser window via hash route: #graph/<epicId>
 * Reuses the full DependencyGraphView with epic pre-filter applied.
 */
import { useState, useCallback, useMemo, useEffect, type CSSProperties } from 'react';

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { Node, Edge, NodeMouseHandler } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { BeadGraphNode } from './BeadGraphNode';
import { BeadGraphEdge } from './BeadGraphEdge';
import { useBeadsGraph, type BeadNodeData } from '../../hooks/useBeadsGraph';
import { api } from '../../services/api';
import type { BeadDetail } from '../../types';

const nodeTypes = { beadNode: BeadGraphNode };
const edgeTypes = { beadEdge: BeadGraphEdge };

export interface EpicGraphPageProps {
  epicId: string;
}

function EpicGraphPageInner({ epicId }: EpicGraphPageProps) {
  const {
    nodes,
    edges,
    loading,
    error,
    toggleCollapse,
    collapseAll,
    expandAll,
    collapsedNodes,
  } = useBeadsGraph({
    epicId,
    pollInterval: 30000,
    enabled: true,
  });

  const [epicTitle, setEpicTitle] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Fetch epic title for the header
  useEffect(() => {
    api.beads.get(epicId)
      .then((data: BeadDetail) => { setEpicTitle(data.title); })
      .catch(() => { /* ignore */ });
  }, [epicId]);

  // Set document title
  useEffect(() => {
    document.title = epicTitle
      ? `${epicId} — ${epicTitle}`
      : `Graph: ${epicId}`;
  }, [epicId, epicTitle]);

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const nodesWithUIState = useMemo(
    () =>
      nodes.map((node: Node<BeadNodeData>) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedNodeId,
          onToggleCollapse: toggleCollapse,
        },
      })),
    [nodes, selectedNodeId, toggleCollapse]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { stroke: '#00aa00', strokeWidth: 1.5 },
      animated: false,
    }),
    []
  );

  const minimapNodeColor = useCallback((node: Node) => {
    const data = node.data;
    const status = data['status'] as string;
    switch (status) {
      case 'closed': return '#00ff00';
      case 'in_progress':
      case 'hooked': return '#ffaa00';
      default: return '#666666';
    }
  }, []);

  // Stats for the header
  const stats = useMemo(() => {
    let open = 0, inProgress = 0, closed = 0;
    for (const n of nodes) {
      const s = (n.data).status;
      if (s === 'closed') closed++;
      else if (s === 'in_progress' || s === 'hooked') inProgress++;
      else open++;
    }
    return { total: nodes.length, open, inProgress, closed };
  }, [nodes]);

  // Selected node info panel
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = nodes.find((n: Node<BeadNodeData>) => n.id === selectedNodeId);
    return node ? node.data : null;
  }, [nodes, selectedNodeId]);

  if (loading && nodes.length === 0) {
    return (
      <div style={styles.page}>
        <div style={styles.centered}>
          LOADING DEPENDENCY GRAPH...
        </div>
      </div>
    );
  }

  if (error && nodes.length === 0) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.centered, color: '#FF4444' }}>
          GRAPH ERROR: {error.message}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      {/* Header bar */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.epicId}>{epicId}</span>
          {epicTitle && <span style={styles.epicTitle}>{epicTitle}</span>}
        </div>
        <div style={styles.headerRight}>
          <span style={styles.stat}>
            <span style={{ color: '#666' }}>{stats.open}</span> OPEN
          </span>
          <span style={styles.stat}>
            <span style={{ color: '#ffaa00' }}>{stats.inProgress}</span> ACTIVE
          </span>
          <span style={styles.stat}>
            <span style={{ color: '#00ff00' }}>{stats.closed}</span> CLOSED
          </span>
          <span style={styles.statDivider}>|</span>
          <button
            style={styles.headerButton}
            onClick={collapsedNodes.size > 0 ? expandAll : collapseAll}
          >
            {collapsedNodes.size > 0 ? 'EXPAND ALL' : 'COLLAPSE ALL'}
          </button>
        </div>
      </div>

      {/* Graph area */}
      <div style={styles.graphArea}>
        {nodes.length === 0 ? (
          <div style={styles.centered}>NO DEPENDENCIES FOUND</div>
        ) : (
          <ReactFlow
            nodes={nodesWithUIState}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            minZoom={0.1}
            maxZoom={3}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="#1a1a1a"
            />
            <Controls
              showInteractive={false}
              style={styles.controls}
            />
            <MiniMap
              style={styles.minimap}
              nodeColor={minimapNodeColor}
              maskColor="rgba(0, 0, 0, 0.7)"
            />
          </ReactFlow>
        )}
      </div>

      {/* Selected node info */}
      {selectedNode && (
        <div style={styles.infoBar}>
          <span style={{
            ...styles.infoId,
            color: selectedNode.status === 'closed' ? '#00ff00'
              : selectedNode.status === 'in_progress' ? '#ffaa00'
              : '#666',
          }}>
            {selectedNode.id}
          </span>
          <span style={styles.infoTitle}>{selectedNode.title}</span>
          <span style={styles.infoBadge}>{selectedNode.status.toUpperCase()}</span>
          <span style={styles.infoBadge}>{selectedNode.beadType.toUpperCase()}</span>
          {selectedNode.assignee && (
            <span style={styles.infoBadge}>{selectedNode.assignee}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function EpicGraphPage(props: EpicGraphPageProps) {
  return (
    <ReactFlowProvider>
      <EpicGraphPageInner {...props} />
    </ReactFlowProvider>
  );
}

const styles = {
  page: {
    width: '100vw',
    height: '100vh',
    backgroundColor: '#0a0a0a',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: '"Share Tech Mono", monospace',
    color: 'var(--crt-phosphor, #00ff00)',
  } satisfies CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderBottom: '1px solid var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flexShrink: 0,
  } satisfies CSSProperties,
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    minWidth: 0,
  } satisfies CSSProperties,
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexShrink: 0,
  } satisfies CSSProperties,
  epicId: {
    fontSize: '0.9rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    color: 'var(--crt-phosphor-bright, #00ff00)',
    flexShrink: 0,
  } satisfies CSSProperties,
  epicTitle: {
    fontSize: '0.8rem',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies CSSProperties,
  stat: {
    fontSize: '0.7rem',
    letterSpacing: '0.08em',
    color: 'var(--crt-phosphor-dim, #00aa00)',
  } satisfies CSSProperties,
  statDivider: {
    color: 'var(--crt-phosphor-dim, #00aa00)',
    opacity: 0.4,
  } satisfies CSSProperties,
  headerButton: {
    padding: '4px 10px',
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    cursor: 'pointer',
    fontFamily: '"Share Tech Mono", monospace',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    background: 'none',
    color: 'var(--crt-phosphor, #00ff00)',
  } satisfies CSSProperties,
  graphArea: {
    flex: 1,
    position: 'relative',
  } satisfies CSSProperties,
  centered: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    letterSpacing: '0.1em',
    fontSize: '0.9rem',
    color: 'var(--crt-phosphor-dim, #00aa00)',
  } satisfies CSSProperties,
  controls: {
    backgroundColor: '#0a0a0a',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    borderRadius: '2px',
  } satisfies CSSProperties,
  minimap: {
    backgroundColor: '#0a0a0a',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    borderRadius: '2px',
  } satisfies CSSProperties,
  infoBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '6px 16px',
    borderTop: '1px solid var(--crt-phosphor-dim, #00aa00)',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    flexShrink: 0,
    minHeight: '32px',
  } satisfies CSSProperties,
  infoId: {
    fontSize: '0.8rem',
    fontWeight: 'bold',
    letterSpacing: '0.1em',
    flexShrink: 0,
  } satisfies CSSProperties,
  infoTitle: {
    fontSize: '0.75rem',
    color: 'var(--crt-phosphor, #00ff00)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  } satisfies CSSProperties,
  infoBadge: {
    fontSize: '0.6rem',
    padding: '2px 6px',
    border: '1px solid var(--crt-phosphor-dim, #00aa00)',
    color: 'var(--crt-phosphor-dim, #00aa00)',
    letterSpacing: '0.05em',
    flexShrink: 0,
  } satisfies CSSProperties,
};
