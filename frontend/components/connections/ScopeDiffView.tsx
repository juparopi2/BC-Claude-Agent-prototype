'use client'

import { Button } from '@/components/ui/button'
import { Plus, Minus, FolderSync } from 'lucide-react'

interface SelectedScope {
  id: string
  name: string
  path: string | null
  isFolder: boolean
  status: 'new' | 'existing' | 'removed'
  existingScopeId?: string
  fileCount?: number
}

interface ScopeDiffViewProps {
  selectedScopes: Map<string, SelectedScope>
  onConfirm: () => void
  onCancel: () => void
}

export function ScopeDiffView({ selectedScopes, onConfirm, onCancel }: ScopeDiffViewProps) {
  const values = Array.from(selectedScopes.values())
  const adding = values.filter((s) => s.status === 'new')
  const removing = values.filter((s) => s.status === 'removed')
  const unchanged = values.filter((s) => s.status === 'existing')

  return (
    <div className="rounded-md border p-3 space-y-3 text-sm">
      <p className="font-medium">Review Changes</p>

      {adding.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
            <Plus className="size-3" />
            Adding ({adding.length})
          </p>
          {adding.map((s) => (
            <p key={s.id} className="text-xs text-muted-foreground pl-4">{s.name}</p>
          ))}
        </div>
      )}

      {removing.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-500 flex items-center gap-1">
            <Minus className="size-3" />
            Removing ({removing.length})
          </p>
          {removing.map((s) => (
            <p key={s.id} className="text-xs text-muted-foreground pl-4">
              {s.name}
              {s.fileCount ? ` — will delete ${s.fileCount} files` : ''}
            </p>
          ))}
        </div>
      )}

      {unchanged.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <FolderSync className="size-3" />
            Unchanged ({unchanged.length})
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onConfirm}>
          Apply Changes
        </Button>
      </div>
    </div>
  )
}
