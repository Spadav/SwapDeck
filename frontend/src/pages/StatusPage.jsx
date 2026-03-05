import React, { useState, useEffect } from 'react'
import { useServiceStatus } from '../hooks/useServiceStatus'
import { useGpuStats } from '../hooks/useGpuStats'

function StatusPage() {
  const { running, pid, refreshStatus } = useServiceStatus(15000)
  const gpuStats = useGpuStats(15000)
  const [proxyLogs, setProxyLogs] = useState([])
  const [upstreamLogs, setUpstreamLogs] = useState([])
  const [logTab, setLogTab] = useState('proxy')
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)

  useEffect(() => {
    const appendLog = (setter) => (event) => {
      const line = event.data
      if (!line) return
      setter((prev) => [...prev, line].slice(-400))
    }

    const proxySource = new EventSource('/api/logs/stream/proxy')
    const upstreamSource = new EventSource('/api/logs/stream/upstream')

    proxySource.onmessage = appendLog(setProxyLogs)
    upstreamSource.onmessage = appendLog(setUpstreamLogs)

    proxySource.onerror = () => {}
    upstreamSource.onerror = () => {}

    return () => {
      proxySource.close()
      upstreamSource.close()
    }
  }, [])

  const visibleLogs = logTab === 'proxy'
    ? proxyLogs.filter((line) => !line.includes('GET /v1/models'))
    : upstreamLogs

  const handleStart = async () => {
    try {
      setStarting(true)
      await fetch('/api/service/start', { method: 'POST' })
      refreshStatus()
    } catch (error) {
      alert('Failed to start service')
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async () => {
    try {
      setStopping(true)
      await fetch('/api/service/stop', { method: 'POST' })
      refreshStatus()
    } catch (error) {
      alert('Failed to stop service')
    } finally {
      setStopping(false)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold tracking-tight">Service Status</h2>
        <div className="flex gap-2">
          <button
            onClick={handleStart}
            disabled={running || starting}
            className="btn btn-primary"
          >
            {starting ? 'Starting...' : 'Start'}
          </button>
          <button
            onClick={handleStop}
            disabled={!running || stopping}
            className="btn btn-danger"
          >
            {stopping ? 'Stopping...' : 'Stop'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-2">Llama Swap</h3>
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${running ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span className="text-xl font-semibold">{running ? 'Running' : 'Stopped'}</span>
          </div>
          {pid && <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>PID: {pid}</p>}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-2">GPU Status</h3>
          <p className="text-xl font-semibold">
            {gpuStats.memoryUsedGb} / {gpuStats.memoryTotalGb} GiB
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Temperature: {gpuStats.temperatureC}°C
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Recent Logs</h3>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setLogTab('proxy')}
              className={`px-3 py-1 rounded ${logTab === 'proxy' ? 'btn-primary text-white' : 'btn-secondary'}`}
            >
              Proxy Logs
            </button>
            <button
              onClick={() => setLogTab('upstream')}
              className={`px-3 py-1 rounded ${logTab === 'upstream' ? 'btn-primary text-white' : 'btn-secondary'}`}
            >
              Upstream Logs
            </button>
          </div>
        </div>
        <div className="p-4 rounded-lg font-mono text-sm overflow-y-auto max-h-96 border" style={{ background: '#0b1220', borderColor: 'var(--line-soft)', color: '#8de4af' }}>
          {visibleLogs.length === 0 ? (
            <div className="whitespace-pre-wrap" style={{ color: '#94a3b8' }}>
              No upstream logs yet. Trigger a model request to populate this stream.
            </div>
          ) : (
            visibleLogs.map((line, index) => (
              <div key={index} className="whitespace-pre-wrap">{line}</div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default StatusPage
