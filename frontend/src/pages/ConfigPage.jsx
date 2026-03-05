import React, { useState, useEffect } from 'react'

function ConfigPage() {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [expandedModels, setExpandedModels] = useState({})
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config')
      if (!response.ok) throw new Error('API error')
      const data = await response.json()
      setConfig(data)
    } catch (error) {
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      if (!response.ok) throw new Error('Save failed')
      alert('Config saved')
    } catch (error) {
      alert('Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  const toggleModel = (key) => {
    setExpandedModels(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const handleModelChange = (modelKey, field, value) => {
    setConfig(prev => ({
      ...prev,
      models: {
        ...prev.models,
        [modelKey]: {
          ...prev.models[modelKey],
          [field]: value
        }
      }
    }))
  }

  const handleFilterChange = (modelKey, value) => {
    setConfig(prev => ({
      ...prev,
      models: {
        ...prev.models,
        [modelKey]: {
          ...prev.models[modelKey],
          filters: { strip_params: value }
        }
      }
    }))
  }

  const removeFilters = (modelKey) => {
    setConfig(prev => {
      const model = { ...prev.models[modelKey] }
      delete model.filters
      return { ...prev, models: { ...prev.models, [modelKey]: model } }
    })
  }

  const handleAliasesChange = (modelKey, value) => {
    const aliases = value.split(',').map(a => a.trim()).filter(Boolean)
    handleModelChange(modelKey, 'aliases', aliases.length > 0 ? aliases : undefined)
  }

  const removeAliases = (modelKey) => {
    setConfig(prev => {
      const model = { ...prev.models[modelKey] }
      delete model.aliases
      return { ...prev, models: { ...prev.models, [modelKey]: model } }
    })
  }

  const deleteModel = (modelKey) => {
    setConfig(prev => {
      const models = { ...prev.models }
      delete models[modelKey]
      return { ...prev, models }
    })
    setDeleteConfirm(null)
  }

  const addModel = () => {
    const key = `NewModel_${Date.now()}`
    setConfig(prev => ({
      ...prev,
      models: {
        ...prev.models,
        [key]: {
          name: 'New Model',
          cmd: '/path/to/llama-server\n-m /path/to/model.gguf\n-ngl 99\n--host 127.0.0.1\n--port ${PORT}\n',
          proxy: 'http://127.0.0.1:${PORT}'
        }
      }
    }))
    setExpandedModels(prev => ({ ...prev, [key]: true }))
  }

  const renameModelKey = (oldKey, newKey) => {
    if (newKey === oldKey || !newKey.trim()) return
    if (config.models[newKey]) {
      alert(`Model key "${newKey}" already exists`)
      return
    }
    setConfig(prev => {
      const entries = Object.entries(prev.models)
      const newModels = {}
      for (const [k, v] of entries) {
        newModels[k === oldKey ? newKey : k] = v
      }
      const newConfig = { ...prev, models: newModels }
      if (prev.healthCheck?.model === oldKey) {
        newConfig.healthCheck = { ...prev.healthCheck, model: newKey }
      }
      return newConfig
    })
    setExpandedModels(prev => {
      const next = { ...prev }
      next[newKey] = next[oldKey]
      delete next[oldKey]
      return next
    })
  }

  if (loading) return <p className="p-6">Loading...</p>
  if (!config) return <p className="p-6 text-red-500">Config file not found</p>

  const inputClass = "w-full px-3 py-2 rounded-lg border bg-transparent"

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Configuration</h2>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Global Settings */}
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Global Settings</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">TTL (seconds)</label>
            <input
              type="number"
              value={config.ttl || 300}
              onChange={(e) => setConfig(prev => ({ ...prev, ttl: parseInt(e.target.value) || 0 }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Health Check Model</label>
            <select
              value={config.healthCheck?.model || ''}
              onChange={(e) => setConfig(prev => ({ ...prev, healthCheck: { ...prev.healthCheck, model: e.target.value } }))}
              className={inputClass}
            >
              <option value="">— none —</option>
              {Object.keys(config.models || {}).map(key => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Models */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Models ({Object.keys(config.models || {}).length})</h3>
          <button onClick={addModel} className="btn btn-primary text-sm">+ Add Model</button>
        </div>

        <div className="space-y-3">
          {Object.entries(config.models || {}).map(([key, model]) => (
            <div key={key} className="card">
              {/* Header - always visible */}
              <button
                onClick={() => toggleModel(key)}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <span className="font-semibold text-lg">{key}</span>
                  <span className="ml-3 text-sm" style={{ color: 'var(--text-muted)' }}>{model.name}</span>
                </div>
                <span className="text-xl" style={{ color: 'var(--text-muted)' }}>{expandedModels[key] ? '▼' : '▶'}</span>
              </button>

              {/* Expanded content */}
              {expandedModels[key] && (
                <div className="mt-4 space-y-4 border-t pt-4" style={{ borderColor: 'var(--line-soft)' }}>
                  {/* Model Key */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Model Key</label>
                    <input
                      type="text"
                      defaultValue={key}
                      onBlur={(e) => renameModelKey(key, e.target.value.trim())}
                      className={inputClass}
                    />
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Name</label>
                    <input
                      type="text"
                      value={model.name || ''}
                      onChange={(e) => handleModelChange(key, 'name', e.target.value)}
                      className={inputClass}
                    />
                  </div>

                  {/* Cmd */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Command</label>
                    <textarea
                      value={model.cmd || ''}
                      onChange={(e) => handleModelChange(key, 'cmd', e.target.value)}
                      rows={8}
                      className={`${inputClass} font-mono text-sm`}
                    />
                  </div>

                  {/* Proxy */}
                  <div>
                    <label className="block text-sm font-medium mb-1">Proxy</label>
                    <input
                      type="text"
                      value={model.proxy || ''}
                      onChange={(e) => handleModelChange(key, 'proxy', e.target.value)}
                      className={`${inputClass} font-mono text-sm`}
                    />
                  </div>

                  {/* Filters */}
                  {model.filters ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium">Filters (strip_params)</label>
                        <button
                          onClick={() => removeFilters(key)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >Remove filters</button>
                      </div>
                      <input
                        type="text"
                        value={model.filters.strip_params || ''}
                        onChange={(e) => handleFilterChange(key, e.target.value)}
                        placeholder="temperature, top_k, top_p"
                        className={`${inputClass} text-sm`}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => handleFilterChange(key, '')}
                      className="text-sm text-blue-500 hover:text-blue-700"
                    >+ Add filters</button>
                  )}

                  {/* Aliases */}
                  {model.aliases ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium">Aliases (comma-separated)</label>
                        <button
                          onClick={() => removeAliases(key)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >Remove aliases</button>
                      </div>
                      <input
                        type="text"
                        value={(model.aliases || []).join(', ')}
                        onChange={(e) => handleAliasesChange(key, e.target.value)}
                        placeholder="alias-1, alias-2"
                        className={`${inputClass} text-sm`}
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => handleModelChange(key, 'aliases', [''])}
                      className="text-sm text-blue-500 hover:text-blue-700"
                    >+ Add aliases</button>
                  )}

                  {/* Delete */}
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--line-soft)' }}>
                    {deleteConfirm === key ? (
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-red-500">Delete this model?</span>
                        <button
                          onClick={() => deleteModel(key)}
                          className="text-sm px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                        >Confirm</button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-sm px-3 py-1 rounded"
                          style={{ background: 'var(--line-soft)' }}
                        >Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(key)}
                        className="text-sm text-red-500 hover:text-red-700"
                      >Delete model</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ConfigPage
