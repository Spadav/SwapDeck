import { useState, useEffect } from 'react'

export function useServiceStatus(pollMs = 10000) {
  const [status, setStatus] = useState({
    running: false,
    pid: null
  })

  const refreshStatus = async () => {
    try {
      const response = await fetch('/api/status')
      if (!response.ok) throw new Error('API error')
      const data = await response.json()
      setStatus({
        running: data.running || false,
        pid: data.pid
      })
    } catch (error) {
      setStatus({ running: false, pid: null })
    }
  }

  useEffect(() => {
    refreshStatus()
    if (!pollMs || pollMs <= 0) return
    const interval = setInterval(refreshStatus, pollMs)
    return () => clearInterval(interval)
  }, [pollMs])

  return {
    ...status,
    refreshStatus
  }
}
