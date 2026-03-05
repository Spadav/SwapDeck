import { useState, useEffect } from 'react'

export function useModels() {
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchModels = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/models')
      if (!response.ok) throw new Error('API error')
      const data = await response.json()
      setModels(data)
      setError(null)
    } catch (err) {
      setModels([])
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchModels()
  }, [])

  return { models, loading, error, refreshModels: fetchModels }
}