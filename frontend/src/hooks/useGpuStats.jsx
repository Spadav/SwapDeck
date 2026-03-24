import { useState, useEffect } from 'react'

export function useGpuStats(pollMs = 10000) {
  const [stats, setStats] = useState({
    memoryUsedGb: 0,
    memoryTotalGb: 0,
    temperatureC: 0,
    gpus: [],
    count: 0,
  })

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/status')
        if (!response.ok) throw new Error('API error')
        const data = await response.json()
        if (data.gpu) {
          setStats({
            memoryUsedGb: data.gpu.memory_used_gb ?? 0,
            memoryTotalGb: data.gpu.memory_total_gb ?? 0,
            temperatureC: data.gpu.temperature_c ?? 0,
            gpus: Array.isArray(data.gpu.gpus) ? data.gpu.gpus : [],
            count: Number(data.gpu.count || 0),
          })
        }
      } catch (error) {
        setStats({ memoryUsedGb: 0, memoryTotalGb: 0, temperatureC: 0, gpus: [], count: 0 })
      }
    }

    fetchStats()
    if (!pollMs || pollMs <= 0) return
    const interval = setInterval(fetchStats, pollMs)
    return () => clearInterval(interval)
  }, [pollMs])

  return stats
}
