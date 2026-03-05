import React, { useState, useEffect } from 'react'

function SettingsPage() {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (!response.ok) throw new Error('API error')
      const data = await response.json()
      setSettings(data)
    } catch (error) {
      setSettings(null)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setMessage(null)
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      if (!response.ok) throw new Error('Save failed')
      const data = await response.json()
      setSettings(data)
      setMessage({ type: 'success', text: 'Settings saved' })
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings' })
    } finally {
      setSaving(false)
    }
  }

  const handleChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  if (loading) return <p className="p-6">Loading...</p>
  if (!settings) return <p className="p-6 text-red-500">Failed to load settings</p>

  const inputClass = "w-full px-3 py-2 rounded-lg border bg-transparent"

  const fields = [
    { key: 'gguf_directory', label: 'GGUF Model Directory', type: 'text', description: 'Where .gguf model files are stored' },
    { key: 'llama_swap_dir', label: 'llama-swap Directory', type: 'text', description: 'llama-swap installation directory' },
    { key: 'llama_swap_config', label: 'llama-swap Config File', type: 'text', description: 'Path to llama-swap config.yaml' },
    { key: 'llama_swap_port', label: 'llama-swap Port', type: 'number', description: 'Port llama-swap listens on' },
    { key: 'backend_port', label: 'Backend Port', type: 'number', description: 'Port this control panel runs on (requires restart)' },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Settings</h2>
        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {message && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm border ${
          message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`} style={{ borderColor: 'var(--line-soft)' }}>
          {message.text}
        </div>
      )}

      <div className="card">
        <div className="space-y-5">
          {fields.map(({ key, label, type, description }) => (
            <div key={key}>
              <label className="block text-sm font-medium mb-1">{label}</label>
              <input
                type={type}
                value={settings[key] ?? ''}
                onChange={(e) => handleChange(key, type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
                className={inputClass}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
