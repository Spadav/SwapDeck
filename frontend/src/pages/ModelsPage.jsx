import React, { useState } from 'react'
import { useModels } from '../hooks/useModels'

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return 'Unknown size'
  const gb = bytes / (1024 ** 3)
  return `${gb.toFixed(2)} GiB`
}

function formatDate(isoDate) {
  if (!isoDate) return '-'
  try {
    return new Date(isoDate).toLocaleString()
  } catch {
    return isoDate
  }
}

function ModelsPage() {
  const { models, loading, error, refreshModels } = useModels()
  const [repoId, setRepoId] = useState('')
  const [repoFiles, setRepoFiles] = useState([])
  const [repoLoading, setRepoLoading] = useState(false)
  const [repoError, setRepoError] = useState('')
  const [selectedFilePath, setSelectedFilePath] = useState('')
  const [downloadUrl, setDownloadUrl] = useState('')
  const [downloadFilename, setDownloadFilename] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)

  const handleDelete = async (filename) => {
    if (!confirm(`Delete ${filename}?`)) return
    
    try {
      await fetch(`/api/models/${filename}`, { method: 'DELETE' })
      refreshModels()
    } catch (error) {
      alert('Failed to delete model')
    }
  }

  const startDownload = async (url, filename) => {
    if (!url || !filename) return

    setDownloading(true)
    setProgress(0)
    
    try {
      const response = await fetch('/api/models/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, filename })
      })
      if (!response.ok) throw new Error('Failed to start download')
      const data = await response.json()

      const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${wsProtocol}://${window.location.host}/ws/download/${data.task_id}`)
      
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.progress !== undefined) {
          setProgress(message.progress)
        }
        if (message.status === 'completed') {
          setDownloading(false)
          setProgress(0)
          refreshModels()
        }
        if (message.status === 'error') {
          setDownloading(false)
          alert(`Download failed: ${message.error}`)
        }
      }
      
      ws.onclose = () => {
        setDownloading(false)
      }
      
    } catch (error) {
      setDownloading(false)
      alert('Failed to start download')
    }
  }

  const handleDownload = async () => {
    await startDownload(downloadUrl, downloadFilename)
  }

  const fetchRepoFiles = async () => {
    if (!repoId.trim()) return
    try {
      setRepoLoading(true)
      setRepoError('')
      setRepoFiles([])
      setSelectedFilePath('')
      const response = await fetch(`/api/hf/repo-files?repo_id=${encodeURIComponent(repoId.trim())}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Failed to fetch repository files')
      setRepoFiles(data.files || [])
      if ((data.files || []).length === 0) {
        setRepoError('No GGUF files found in this repository')
      }
    } catch (error) {
      setRepoError(error.message || 'Failed to fetch repository files')
    } finally {
      setRepoLoading(false)
    }
  }

  const handleRepoDownload = async () => {
    const file = repoFiles.find(f => f.path === selectedFilePath)
    if (!file) return
    await startDownload(file.download_url, file.filename)
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold tracking-tight mb-6">Model Management</h2>
      
      <div className="mb-6 card">
        <h3 className="text-lg font-semibold mb-4">Download Model</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Hugging Face Repository</label>
            <input
              type="text"
              value={repoId}
              onChange={(e) => setRepoId(e.target.value)}
              placeholder="unsloth/Qwen3.5-35B-A3B-GGUF"
              className="w-full px-3 py-2 rounded-lg border dark:border-gray-600 dark:bg-gray-700"
            />
          </div>
          <button
            onClick={fetchRepoFiles}
            disabled={repoLoading || downloading || !repoId.trim()}
            className="btn btn-secondary"
          >
            {repoLoading ? 'Loading files...' : 'Load GGUF Files'}
          </button>

          {repoError && (
            <p className="text-sm text-red-500">{repoError}</p>
          )}

          {repoFiles.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">GGUF File</label>
              <select
                value={selectedFilePath}
                onChange={(e) => setSelectedFilePath(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border dark:border-gray-600 dark:bg-gray-700"
              >
                <option value="">Select a file...</option>
                {repoFiles.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path} ({formatSize(file.size_bytes)})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <button
              onClick={handleRepoDownload}
              disabled={downloading || !selectedFilePath}
              className="btn btn-primary"
            >
              {downloading ? 'Downloading...' : 'Download Selected File'}
            </button>
          </div>

          <details className="rounded-lg border dark:border-gray-600 p-3">
            <summary className="cursor-pointer text-sm font-medium">Advanced: Direct URL</summary>
            <div className="space-y-3 mt-3">
              <div>
                <label className="block text-sm font-medium mb-1">Direct URL</label>
                <input
                  type="url"
                  value={downloadUrl}
                  onChange={(e) => setDownloadUrl(e.target.value)}
                  placeholder="https://huggingface.co/.../resolve/main/model.gguf?download=true"
                  className="w-full px-3 py-2 rounded-lg border dark:border-gray-600 dark:bg-gray-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Save As Filename</label>
                <input
                  type="text"
                  value={downloadFilename}
                  onChange={(e) => setDownloadFilename(e.target.value)}
                  placeholder="model.gguf"
                  className="w-full px-3 py-2 rounded-lg border dark:border-gray-600 dark:bg-gray-700"
                />
              </div>
              <button
                onClick={handleDownload}
                disabled={downloading || !downloadUrl || !downloadFilename}
                className="btn btn-secondary"
              >
                Start Direct Download
              </button>
            </div>
          </details>

          {downloading && (
            <div className="w-full rounded-full h-2" style={{ background: 'var(--line-soft)' }}>
              <div
                className="h-2 rounded-full transition-all"
                style={{ width: `${progress}%`, background: 'var(--brand)' }}
              />
            </div>
          )}
        </div>
      </div>
      
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Installed Models</h3>
          <button onClick={refreshModels} className="btn btn-secondary text-sm">
            Refresh
          </button>
        </div>
        
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        ) : error ? (
          <p className="text-red-500">Error: {error}</p>
        ) : models.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>No models installed</p>
        ) : (
          <div className="space-y-2">
            {models.map((model) => (
              <div
                key={model.filename}
                className="flex items-center justify-between p-3 rounded-lg border"
                style={{ borderColor: 'var(--line-soft)', background: 'rgba(148, 163, 184, 0.08)' }}
              >
                <div>
                  <p className="font-medium">{model.filename}</p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    {model.size_gb} GiB • {formatDate(model.modified)}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(model.filename)}
                  className="btn btn-danger text-sm"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ModelsPage
