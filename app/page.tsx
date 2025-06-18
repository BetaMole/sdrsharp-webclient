"use client"

import type React from "react"

import { useEffect, useRef, useState } from "react"
import { Play, Pause, Settings, Volume2, Plus, Minus, RotateCcw, Bookmark, Scan } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Checkbox } from "@/components/ui/checkbox"
import { useSDRStore } from "@/lib/store"
import { useRTLSDR } from "@/lib/RTLSDRContext"
import { DirectSampling } from '@jtarrio/webrtlsdr/rtlsdr'

export default function SDRSharp() {
  // Get RTL-SDR context
  const {
    isConnected,
    isPlaying,
    centerFrequency,
    sampleRate,
    gain,
    demodMode,
    bandwidth,
    volume,
    ppm,
    directSampling,
    biasTee,
    agc,
    deviceName,
    deviceStatus,
    connect,
    disconnect,
    resetDevice,
    play,
    stop,
    setFrequency,
    setSampleRate,
    setGain,
    setDemodMode,
    setBandwidth,
    setVolume,
    setPpm,
    setDirectSampling,
    setBiasTee,
    setAgc,
    getSpectrumData
  } = useRTLSDR()

  // Get UI state from store
  const {
    zoom,
    contrast,
    range,
    scanner,
    bookmarks,
      setZoom,
  setContrast,
  setRange,
  setScanner,
    addBookmark,
    removeBookmark,
  } = useSDRStore()

  // Local UI state
  const [useHang, setUseHang] = useState(false)
  const [frequencyShift, setFrequencyShift] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showConfigMenu, setShowConfigMenu] = useState(false)
  const [showBookmarks, setShowBookmarks] = useState(false)
  const [showPresetMenu, setShowPresetMenu] = useState(false)
  const [newBookmarkName, setNewBookmarkName] = useState("")
  const [spectrumCollapsed, setSpectrumCollapsed] = useState(false)
  const [waterfallCollapsed, setWaterfallCollapsed] = useState(false)
  const [ifSpectrumCollapsed, setIfSpectrumCollapsed] = useState(false)

  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null)
  const waterfallCanvasRef = useRef<HTMLCanvasElement>(null)
  const ifSpectrumCanvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>(0)
  const scannerRef = useRef<NodeJS.Timeout>(null as any)

  // Add drag functionality
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, freq: 0 })

  // State to track frequency changes for visual indicator
  const [frequencyChanging, setFrequencyChanging] = useState(false);
  
  // Update frequency with visual indicator
  const updateFrequency = (newFreq: number) => {
    setFrequencyChanging(true);
    setFrequency(newFreq);
    
    // Reset indicator after a short delay
    setTimeout(() => {
      setFrequencyChanging(false);
    }, 500);
  };

  // Get real spectrum data from RTL-SDR with proper fallback
  const getSpectrumDataForDisplay = () => {
    // Try to get real data from RTL-SDR
    if (isPlaying) {
      const realData = getSpectrumData()
      
      if (realData && realData.length > 0) {
        // Analyze data to detect if it's real or just zeros/flat
        let nonZeroValues = 0;
        let totalVariation = 0;
        let prevVal = realData[0];
        
        for (let i = 0; i < realData.length; i++) {
          if (realData[i] !== 0 && realData[i] !== -100) {
            nonZeroValues++;
          }
          
          if (i > 0) {
            totalVariation += Math.abs(realData[i] - prevVal);
          }
          prevVal = realData[i];
        }
        
        const avgVariation = totalVariation / (realData.length - 1);
        
        if (nonZeroValues < 5) {
          console.warn('RTL-SDR data has very few non-zero values:', nonZeroValues);
        }
        
        if (avgVariation < 0.1) {
          console.warn('RTL-SDR data has very little variation:', avgVariation.toFixed(3));
        }
        
        console.log(`Using RTL-SDR data: ${realData.length} points, ${nonZeroValues} non-zero, avg variation: ${avgVariation.toFixed(3)}`);
        return realData;
      }
    }
    
    // If we're connected but not getting data, show empty spectrum
    if (isConnected && isPlaying) {
      console.log('RTL-SDR connected but waiting for data...')
      
      // Create empty data with slight random noise to show we're attempting to receive
      const emptyData = new Float32Array(1024)
      for (let i = 0; i < emptyData.length; i++) {
        emptyData[i] = -100 + Math.random() * 3; // Empty spectrum at ~-100 dB with tiny variation
      }
      return emptyData
    }
    
    // Return null if not connected or not playing
    console.log('RTL-SDR not connected or not playing')
    return null
  }

  // Enhanced canvas mouse interactions
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const relativeX = x / canvas.width

    // Calculate clicked frequency based on current span
    const span = sampleRate / zoom // Adjust span based on zoom
    const clickedFreq = centerFrequency - span / 2 + relativeX * span

    setFrequency(Math.round(clickedFreq))
  }

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const relativeX = x / canvas.width

    const span = sampleRate / zoom
    const clickedFreq = centerFrequency - span / 2 + relativeX * span

    // Double click for precise tuning
    setFrequency(Math.round(clickedFreq))
  }

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()

    // Get mouse position for zoom center
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const relativeX = x / canvas.width
    
    // Calculate frequency at cursor position
    const span = sampleRate / zoom
    const freqAtCursor = centerFrequency - span / 2 + relativeX * span

    if (e.ctrlKey) {
      // Zoom with Ctrl+Wheel
      const zoomFactor = e.deltaY > 0 ? 0.8 : 1.25 // Zoom out or in
      const newZoom = Math.max(1, Math.min(100, zoom * zoomFactor))
      
      // Adjust center frequency to keep the frequency under cursor stable
      if (newZoom !== zoom) {
        const newSpan = sampleRate / newZoom
        const newCenterFreq = freqAtCursor - (relativeX - 0.5) * newSpan
        setFrequency(Math.round(newCenterFreq))
        setZoom(newZoom)
      }
    } else if (e.shiftKey) {
      // Fine tuning with Shift+Wheel
      const delta = e.deltaY > 0 ? -100 : 100
      setFrequency(centerFrequency + delta)
    } else {
      // Normal frequency tuning
      const delta = e.deltaY > 0 ? -10000 : 10000
      setFrequency(centerFrequency + delta)
    }
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left

    setIsDragging(true)
    setDragStart({ x, freq: centerFrequency })
    canvas.style.cursor = "grabbing"
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget

    if (isDragging) {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const deltaX = x - dragStart.x
      const span = sampleRate / zoom
      const freqDelta = -(deltaX / canvas.width) * span

      setFrequency(Math.round(dragStart.freq + freqDelta))
    } else {
      // Show frequency under cursor
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const relativeX = x / canvas.width
      const span = sampleRate / zoom
      const hoverFreq = centerFrequency - span / 2 + relativeX * span

      canvas.title = `${(hoverFreq / 1000000).toFixed(6)} MHz`
    }
  }

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    setIsDragging(false)
    canvas.style.cursor = "crosshair"
  }

  const handleCanvasMouseLeave = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget
    setIsDragging(false)
    canvas.style.cursor = "crosshair"
  }

  const handleAddBookmark = () => {
    if (newBookmarkName.trim()) {
      addBookmark({
        name: newBookmarkName,
        frequency: centerFrequency,
        mode: demodMode,
      })
      setNewBookmarkName("")
    }
  }

  // Enhanced waterfall with better color mapping and forced updates
  const drawWaterfall = (canvas: HTMLCanvasElement, data: Float32Array) => {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx || !data || data.length === 0) return

    try {
      // Get current image data and scroll up
      if (canvas.height > 1) {
        try {
          const imageData = ctx.getImageData(0, 1, canvas.width, canvas.height - 1)
          ctx.putImageData(imageData, 0, 0)
        } catch (e) {
          // If there's an error, clear and start over
          ctx.fillStyle = '#000'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
      }

      // Draw new line at bottom with enhanced processing
      const newLine = ctx.createImageData(canvas.width, 1)
      
      // Use better interpolation for smoother waterfall
      const dataStep = data.length / canvas.width
      
      // Apply smoothing for better visual quality
      const smoothedData = new Float32Array(canvas.width)
      const smoothRadius = 1.5
      
      // First pass - calculate smoothed values with Gaussian-like weighting
      for (let i = 0; i < canvas.width; i++) {
        let sum = 0
        let weight = 0
        
        const startIdx = Math.max(0, Math.floor((i - smoothRadius) * dataStep))
        const endIdx = Math.min(data.length - 1, Math.ceil((i + smoothRadius) * dataStep))
        
        for (let j = startIdx; j <= endIdx; j++) {
          const dataIdx = j / dataStep
          const distance = Math.abs(i - dataIdx)
          const w = Math.exp(-distance * distance / (2 * smoothRadius * smoothRadius))
          
          sum += data[j] * w
          weight += w
        }
        
        smoothedData[i] = weight > 0 ? sum / weight : -120
      }
      
      // Apply waterfall-specific processing
      for (let i = 0; i < canvas.width; i++) {
        // Get smoothed value and apply contrast/range adjustments
        let value = smoothedData[i]
        
        // Apply range and contrast settings
        value = Math.max(range.min, Math.min(range.max, value))
        const normalizedValue = (value - range.min) / (range.max - range.min)
        
        // Apply contrast enhancement
        const contrastAdjusted = Math.pow(normalizedValue, 1.0 / Math.max(0.1, Math.abs(contrast.min) / 50))
        const intensity = Math.max(0, Math.min(1, contrastAdjusted))
        
        const pixelIndex = i * 4

        // Enhanced SDR# style color mapping: black -> blue -> cyan -> green -> yellow -> red -> white
        if (intensity < 0.15) {
          // Black to dark blue
          const t = intensity / 0.15
          newLine.data[pixelIndex] = Math.floor(t * 32)       // R
          newLine.data[pixelIndex + 1] = Math.floor(t * 32)   // G
          newLine.data[pixelIndex + 2] = Math.floor(t * 128)  // B
        } else if (intensity < 0.3) {
          // Dark blue to cyan
          const t = (intensity - 0.15) / 0.15
          newLine.data[pixelIndex] = 0                        // R
          newLine.data[pixelIndex + 1] = Math.floor(t * 255)  // G
          newLine.data[pixelIndex + 2] = 128 + Math.floor(t * 127) // B
        } else if (intensity < 0.5) {
          // Cyan to green
          const t = (intensity - 0.3) / 0.2
          newLine.data[pixelIndex] = 0                        // R
          newLine.data[pixelIndex + 1] = 255                  // G
          newLine.data[pixelIndex + 2] = Math.floor((1 - t) * 255) // B
        } else if (intensity < 0.7) {
          // Green to yellow
          const t = (intensity - 0.5) / 0.2
          newLine.data[pixelIndex] = Math.floor(t * 255)      // R
          newLine.data[pixelIndex + 1] = 255                  // G
          newLine.data[pixelIndex + 2] = 0                    // B
        } else if (intensity < 0.85) {
          // Yellow to red
          const t = (intensity - 0.7) / 0.15
          newLine.data[pixelIndex] = 255                      // R
          newLine.data[pixelIndex + 1] = Math.floor((1 - t) * 255) // G
          newLine.data[pixelIndex + 2] = 0                    // B
        } else {
          // Red to white (strong signals)
          const t = (intensity - 0.85) / 0.15
          newLine.data[pixelIndex] = 255                      // R
          newLine.data[pixelIndex + 1] = Math.floor(t * 255)  // G
          newLine.data[pixelIndex + 2] = Math.floor(t * 255)  // B
        }
        
        newLine.data[pixelIndex + 3] = 255 // Alpha
      }

      ctx.putImageData(newLine, 0, canvas.height - 1)
      
      // Draw frequency scale overlay with current frequency
      const span = sampleRate / zoom
      const startFreq = centerFrequency - span / 2
      
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
      ctx.fillRect(0, canvas.height - 18, canvas.width, 18)
      
      ctx.fillStyle = '#ffffff'
      ctx.font = '10px monospace'
      ctx.textAlign = 'center'
      
      // Draw frequency ticks every 10% of width
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * canvas.width
        const freq = startFreq + (i / 10) * span
        let freqText = ""
        
        if (freq >= 1e9) {
          freqText = (freq / 1e9).toFixed(2) + "G"
        } else if (freq >= 1e6) {
          freqText = (freq / 1e6).toFixed(2) + "M"
        } else if (freq >= 1e3) {
          freqText = (freq / 1e3).toFixed(0) + "k"
        } else {
          freqText = freq.toFixed(0)
        }
        
        // Draw tick mark
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x - 0.5, canvas.height - 18, 1, 4)
        
        // Draw frequency label
        ctx.fillText(freqText, x, canvas.height - 4)
      }
      
      // Draw center frequency marker
      const centerX = canvas.width / 2
      ctx.fillStyle = '#ff0000'
      ctx.fillRect(centerX - 1, canvas.height - 18, 2, 18)
      
    } catch (error) {
      console.error('Waterfall drawing error:', error)
    }
  }

  // Enhanced spectrum drawing with SDR# style visuals
  const drawSpectrum = (canvas: HTMLCanvasElement, data: Float32Array, title: string) => {
    const ctx = canvas.getContext("2d", { alpha: false })
    if (!ctx) return

    // Clear canvas with dark background
    ctx.fillStyle = "#0a0a0a"
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Draw professional grid system
    ctx.strokeStyle = "#2a2a2a"
    ctx.lineWidth = 1

    // Major vertical grid lines (frequency) - every 10%
    for (let i = 0; i <= 10; i++) {
      const x = Math.floor((i / 10) * canvas.width) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, canvas.height - 25)
      ctx.stroke()
    }

    // Minor vertical grid lines
    ctx.strokeStyle = "#1a1a1a"
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 50; i++) {
      const x = Math.floor((i / 50) * canvas.width) + 0.5
      if (i % 5 !== 0) { // Skip major grid lines
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, canvas.height - 25)
        ctx.stroke()
      }
    }

    // Major horizontal grid lines (dB)
    ctx.strokeStyle = "#2a2a2a"
    ctx.lineWidth = 1
    for (let i = 0; i <= 8; i++) {
      const y = Math.floor((i / 8) * (canvas.height - 25)) + 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(canvas.width, y)
      ctx.stroke()
    }

    // Minor horizontal grid lines
    ctx.strokeStyle = "#1a1a1a"
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 32; i++) {
      const y = Math.floor((i / 32) * (canvas.height - 25)) + 0.5
      if (i % 4 !== 0) { // Skip major grid lines
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(canvas.width, y)
        ctx.stroke()
      }
    }

    // Calculate span based on zoom
    const span = sampleRate / zoom
    const startFreq = centerFrequency - span / 2
    const endFreq = centerFrequency + span / 2
    
    // Apply advanced smoothing for professional SDR# style spectrum
    const smoothedData = new Float32Array(canvas.width)
    const smoothRadius = 2.5
    const dataStep = data.length / canvas.width
    
    // Advanced spectrum smoothing with proper interpolation
    for (let i = 0; i < canvas.width; i++) {
      let sum = 0
      let weight = 0
      
      // Get data range for this pixel
      const centerIdx = i * dataStep
      const startIdx = Math.max(0, Math.floor(centerIdx - smoothRadius))
      const endIdx = Math.min(data.length - 1, Math.ceil(centerIdx + smoothRadius))
      
      // Apply Gaussian-weighted smoothing
      for (let j = startIdx; j <= endIdx; j++) {
        const distance = Math.abs(j - centerIdx)
        const w = Math.exp(-distance * distance / (2 * smoothRadius * smoothRadius))
        
        sum += data[j] * w
        weight += w
      }
      
      smoothedData[i] = weight > 0 ? sum / weight : -120
    }

    // Create professional SDR# style gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height - 25)
    gradient.addColorStop(0, 'rgba(135, 206, 250, 0.8)') // Light blue at top
    gradient.addColorStop(0.3, 'rgba(70, 130, 180, 0.6)') // Steel blue
    gradient.addColorStop(0.6, 'rgba(25, 25, 112, 0.4)') // Navy blue  
    gradient.addColorStop(1, 'rgba(0, 0, 139, 0.2)') // Dark blue at bottom

    // Draw filled spectrum area
    ctx.fillStyle = gradient
    ctx.beginPath()
    
    let firstPoint = true
    for (let i = 0; i < canvas.width; i++) {
      const x = i
      const dbValue = Math.max(-120, Math.min(0, smoothedData[i]))
      const y = canvas.height - 25 - ((dbValue + 120) / 120) * (canvas.height - 25)

      if (firstPoint) {
        ctx.moveTo(x, y)
        firstPoint = false
      } else {
        ctx.lineTo(x, y)
      }
    }
    
    // Complete the fill path
    ctx.lineTo(canvas.width - 1, canvas.height - 25)
    ctx.lineTo(0, canvas.height - 25)
    ctx.closePath()
    ctx.fill()

    // Draw spectrum line with SDR# style
    ctx.strokeStyle = "#87CEEB" // Sky blue
    ctx.lineWidth = 1.5
    ctx.shadowColor = "#87CEEB"
    ctx.shadowBlur = 2
    ctx.beginPath()
    
    firstPoint = true
    for (let i = 0; i < canvas.width; i++) {
      const x = i
      const dbValue = Math.max(-120, Math.min(0, smoothedData[i]))
      const y = canvas.height - 25 - ((dbValue + 120) / 120) * (canvas.height - 25)

      if (firstPoint) {
        ctx.moveTo(x, y)
        firstPoint = false
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
    
    // Reset shadow
    ctx.shadowBlur = 0

    // Draw professional frequency scale background
    ctx.fillStyle = 'rgba(20, 20, 20, 0.9)'
    ctx.fillRect(0, canvas.height - 25, canvas.width, 25)

    // Draw frequency labels with SDR# styling
    ctx.fillStyle = "#cccccc"
    ctx.font = "11px 'Segoe UI', Arial, sans-serif"
    ctx.textAlign = "center"
    
    for (let i = 0; i <= 10; i++) {
      const freq = startFreq + (i / 10) * span
      const x = (i / 10) * canvas.width
      let freqText = ""

      if (freq >= 1e9) {
        freqText = (freq / 1e9).toFixed(3) + " GHz"
      } else if (freq >= 1e6) {
        freqText = (freq / 1e6).toFixed(3) + " MHz"
      } else if (freq >= 1e3) {
        freqText = (freq / 1e3).toFixed(1) + " kHz"
      } else {
        freqText = freq.toFixed(0) + " Hz"
      }

      ctx.fillText(freqText, x, canvas.height - 8)
    }

    // Draw dB scale on the left side
    ctx.textAlign = "left"
    ctx.fillStyle = "#aaaaaa"
    ctx.font = "10px 'Segoe UI', Arial, sans-serif"
    
    for (let i = 0; i <= 8; i++) {
      const db = -120 + (i / 8) * 120
      const y = (canvas.height - 25) - (i / 8) * (canvas.height - 25)
      ctx.fillText(db.toFixed(0) + " dB", 5, y - 2)
    }

    // Draw title and center frequency info
    ctx.fillStyle = "#ffffff"
    ctx.font = "12px 'Segoe UI', Arial, sans-serif"
    ctx.textAlign = "left"
    ctx.fillText(`${title} - Center: ${(centerFrequency / 1e6).toFixed(6)} MHz`, 10, 15)
    
    // Draw span information
    ctx.fillStyle = "#dddddd"
    ctx.font = "10px 'Segoe UI', Arial, sans-serif"
    let spanText = ""
    if (span >= 1e6) {
      spanText = `Span: ${(span / 1e6).toFixed(2)} MHz`
    } else if (span >= 1e3) {
      spanText = `Span: ${(span / 1e3).toFixed(1)} kHz`
    } else {
      spanText = `Span: ${span.toFixed(0)} Hz`
    }
    ctx.fillText(spanText, 10, 30)
    
    // Draw zoom level
    ctx.textAlign = "right"
    ctx.fillText(`Zoom: ${zoom.toFixed(1)}x`, canvas.width - 10, 15)

    // Draw center frequency marker (red line)
    const centerX = canvas.width / 2
    ctx.strokeStyle = "#ff4444"
    ctx.lineWidth = 2
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(centerX, 0)
    ctx.lineTo(centerX, canvas.height - 25)
    ctx.stroke()
    
    // Add center frequency label
    ctx.fillStyle = "#ff4444"
    ctx.font = "10px 'Segoe UI', Arial, sans-serif"
    ctx.textAlign = "center"
    ctx.fillText(`${(centerFrequency / 1e6).toFixed(3)}`, centerX, canvas.height - 30)
    
    // Draw bandwidth markers if applicable
    if (title === "RF FFT" && bandwidth > 0) {
      const bwInPixels = (bandwidth / span) * canvas.width
      const leftX = centerX - bwInPixels / 2
      const rightX = centerX + bwInPixels / 2
      
      ctx.strokeStyle = "#ffaa00"
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 2])
      
      // Left bandwidth marker
      if (leftX >= 0 && leftX <= canvas.width) {
        ctx.beginPath()
        ctx.moveTo(leftX, 0)
        ctx.lineTo(leftX, canvas.height - 25)
        ctx.stroke()
      }
      
      // Right bandwidth marker
      if (rightX >= 0 && rightX <= canvas.width) {
        ctx.beginPath()
        ctx.moveTo(rightX, 0)
        ctx.lineTo(rightX, canvas.height - 25)
        ctx.stroke()
      }
      
      // Reset line dash
      ctx.setLineDash([])
      
      // Draw bandwidth text
      ctx.fillStyle = "#ffaa00"
      ctx.font = "10px 'Segoe UI', Arial, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText(`BW: ${(bandwidth / 1000).toFixed(1)} kHz`, centerX, 45)
    }
  }

  // Scanner functionality
  useEffect(() => {
    if (scanner.enabled && isPlaying) {
      scannerRef.current = setInterval(() => {
        setScanner({
          currentFreq: scanner.currentFreq + scanner.stepSize,
        })

        if (scanner.currentFreq >= scanner.endFreq) {
          setScanner({ currentFreq: scanner.startFreq })
        }

        setFrequency(scanner.currentFreq)
      }, scanner.speed)
    } else {
      if (scannerRef.current) {
        clearInterval(scannerRef.current)
      }
    }

    return () => {
      if (scannerRef.current) {
        clearInterval(scannerRef.current)
      }
    }
  }, [
    scanner.enabled,
    scanner.currentFreq,
    scanner.stepSize,
    scanner.endFreq,
    scanner.startFreq,
    scanner.speed,
    isPlaying,
  ])

  // Animation loop - only runs with real RTL-SDR data
  const animate = () => {
    if (!isPlaying) {
      console.log('Animation stopped - not playing')
      return
    }

    try {
      const spectrumData = getSpectrumDataForDisplay()
      
      // Only proceed if we have real data
      if (!spectrumData) {
        console.log('No real data available, skipping animation frame')
        animationRef.current = requestAnimationFrame(animate)
        return
      }
      
      console.log('Animation tick - data length:', spectrumData.length)

      if (spectrumCanvasRef.current && !spectrumCollapsed) {
        // Ensure canvas size matches parent container
        const spectrumParent = spectrumCanvasRef.current.parentElement
        if (spectrumParent) {
          const targetWidth = spectrumParent.clientWidth
          const targetHeight = Math.max(1, spectrumParent.clientHeight - 8)
          
          if (spectrumCanvasRef.current.width !== targetWidth || 
              spectrumCanvasRef.current.height !== targetHeight) {
            spectrumCanvasRef.current.width = targetWidth
            spectrumCanvasRef.current.height = targetHeight
            console.log('Spectrum canvas resized to:', targetWidth, 'x', targetHeight)
          }
        }
        
        drawSpectrum(spectrumCanvasRef.current, spectrumData, "RF FFT")
      }

      if (waterfallCanvasRef.current && !waterfallCollapsed) {
        // Ensure canvas size matches parent container
        const waterfallParent = waterfallCanvasRef.current.parentElement
        if (waterfallParent) {
          const targetWidth = waterfallParent.clientWidth
          const targetHeight = Math.max(1, waterfallParent.clientHeight - 8)
          
          if (waterfallCanvasRef.current.width !== targetWidth || 
              waterfallCanvasRef.current.height !== targetHeight) {
            waterfallCanvasRef.current.width = targetWidth
            waterfallCanvasRef.current.height = targetHeight
            console.log('Waterfall canvas resized to:', targetWidth, 'x', targetHeight)
            // Clear waterfall when resizing
            const ctx = waterfallCanvasRef.current.getContext('2d')
            if (ctx) {
              ctx.fillStyle = '#000'
              ctx.fillRect(0, 0, waterfallCanvasRef.current.width, waterfallCanvasRef.current.height)
            }
          }
        }
        
        drawWaterfall(waterfallCanvasRef.current, spectrumData)
        console.log('Waterfall drawn')
      }

      if (ifSpectrumCanvasRef.current && !ifSpectrumCollapsed) {
        // Ensure canvas size matches parent container
        const ifSpectrumParent = ifSpectrumCanvasRef.current.parentElement
        if (ifSpectrumParent) {
          const targetWidth = ifSpectrumParent.clientWidth
          const targetHeight = Math.max(1, ifSpectrumParent.clientHeight - 8)
          
          if (ifSpectrumCanvasRef.current.width !== targetWidth || 
              ifSpectrumCanvasRef.current.height !== targetHeight) {
            ifSpectrumCanvasRef.current.width = targetWidth
            ifSpectrumCanvasRef.current.height = targetHeight
          }
        }
        
        const ifData = spectrumData.slice(400, 624)
        drawSpectrum(ifSpectrumCanvasRef.current, ifData, "IF Spectrum")
      }
    } catch (error) {
      console.error('Animation error:', error)
    }

    animationRef.current = requestAnimationFrame(animate)
  }

  // Add resize handler
  useEffect(() => {
    const handleResize = () => {
      // Force canvas resize on window resize
      if (spectrumCanvasRef.current && spectrumCanvasRef.current.parentElement) {
        spectrumCanvasRef.current.width = spectrumCanvasRef.current.parentElement.clientWidth
        spectrumCanvasRef.current.height = Math.max(1, spectrumCanvasRef.current.parentElement.clientHeight - 8)
      }
      
      if (waterfallCanvasRef.current && waterfallCanvasRef.current.parentElement) {
        waterfallCanvasRef.current.width = waterfallCanvasRef.current.parentElement.clientWidth
        waterfallCanvasRef.current.height = Math.max(1, waterfallCanvasRef.current.parentElement.clientHeight - 8)
      }
      
      if (ifSpectrumCanvasRef.current && ifSpectrumCanvasRef.current.parentElement) {
        ifSpectrumCanvasRef.current.width = ifSpectrumCanvasRef.current.parentElement.clientWidth
        ifSpectrumCanvasRef.current.height = Math.max(1, ifSpectrumCanvasRef.current.parentElement.clientHeight - 8)
      }
    }
    
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Force updates when frequency changes to fix frequency labels
  useEffect(() => {
    // Force redraw of all canvases when center frequency changes
    if (isPlaying) {
      // Small delay to ensure state is updated
      setTimeout(() => {
        const spectrumData = getSpectrumDataForDisplay()
        
        // Only draw if we have real data
        if (spectrumData) {
          if (spectrumCanvasRef.current && !spectrumCollapsed) {
            drawSpectrum(spectrumCanvasRef.current, spectrumData, "RF FFT")
          }
          
          if (ifSpectrumCanvasRef.current && !ifSpectrumCollapsed) {
            const ifData = spectrumData.slice(400, 624)
            drawSpectrum(ifSpectrumCanvasRef.current, ifData, "IF Spectrum")
          }
        }
        
        if (waterfallCanvasRef.current && !waterfallCollapsed) {
          // Clear waterfall when frequency changes significantly
          const ctx = waterfallCanvasRef.current.getContext('2d')
          if (ctx) {
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, waterfallCanvasRef.current.width, waterfallCanvasRef.current.height)
          }
        }
      }, 50)
    }
  }, [centerFrequency, zoom, sampleRate])

  // Force updates when zoom changes
  useEffect(() => {
    if (isPlaying) {
      const spectrumData = getSpectrumDataForDisplay()
      
      // Only draw if we have real data
      if (spectrumData) {
        if (spectrumCanvasRef.current && !spectrumCollapsed) {
          drawSpectrum(spectrumCanvasRef.current, spectrumData, "RF FFT")
        }
        
        if (waterfallCanvasRef.current && !waterfallCollapsed) {
          drawWaterfall(waterfallCanvasRef.current, spectrumData)
        }
        
        if (ifSpectrumCanvasRef.current && !ifSpectrumCollapsed) {
          const ifData = spectrumData.slice(400, 624)
          drawSpectrum(ifSpectrumCanvasRef.current, ifData, "IF Spectrum")
        }
      }
    }
  }, [zoom])

  useEffect(() => {
    console.log('Animation useEffect triggered, isPlaying:', isPlaying)
    
    if (isPlaying) {
      // Cancel any existing animation
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      
      // Start new animation
      console.log('Starting animation loop')
      animate()
      
      // Force initial spectrum update after a short delay
      setTimeout(() => {
        try {
          const spectrumData = getSpectrumDataForDisplay()
          if (spectrumData) {
            console.log('Initial spectrum data received, length:', spectrumData.length)
            
            if (spectrumCanvasRef.current) {
              drawSpectrum(spectrumCanvasRef.current, spectrumData, "RF FFT")
            }
            
            if (waterfallCanvasRef.current) {
              drawWaterfall(waterfallCanvasRef.current, spectrumData)
            }
            
            if (ifSpectrumCanvasRef.current) {
              const ifData = spectrumData.slice(400, 624)
              drawSpectrum(ifSpectrumCanvasRef.current, ifData, "IF Spectrum")
            }
          } else {
            console.warn('No initial spectrum data available')
          }
        } catch (error) {
          console.error('Error in initial spectrum update:', error)
        }
      }, 1000)
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        console.log('Animation stopped')
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isPlaying, spectrumCollapsed, waterfallCollapsed, ifSpectrumCollapsed, centerFrequency, zoom, getSpectrumDataForDisplay, drawSpectrum, drawWaterfall])
  
  // Function to tune to specific preset frequencies
  const tuneToPreset = (freq: number) => {
    console.log(`Tuning to preset frequency: ${freq/1e6} MHz`);
    updateFrequency(freq);
    
    // If we're not playing, start playing
    if (!isPlaying && isConnected) {
      play().catch(error => {
        console.error('Failed to start playback after tuning to preset:', error);
      });
    }
  };

  // Tune to known strong frequency when connected
  useEffect(() => {
    if (isConnected && isPlaying) {
      console.log('Device connected and playing, tuning to known strong frequency...')
      
      // Try to tune to an FM broadcast frequency (typically strong signals)
      const fmFrequency = 100.1e6 // 100.1 MHz - common FM broadcast frequency
      setFrequency(fmFrequency)
      
      // Set appropriate mode for FM broadcast
      setDemodMode('WBFM')
      
      // Set gain to a moderate level if currently at auto
      if (gain === null) {
        setGain(20)
      }
      
      console.log('Tuned to FM broadcast band for testing')
    }
  }, [isConnected, isPlaying, setFrequency, setDemodMode, setGain, gain])

  // Force immediate update when frequency changes
  useEffect(() => {
    if (isPlaying) {
      console.log(`Frequency changed to ${centerFrequency} Hz, forcing immediate update`)
      
      // Force immediate redraw without waiting for animation frame
      try {
        const spectrumData = getSpectrumDataForDisplay()
        
        if (spectrumData) {
          // Update spectrum display
          if (spectrumCanvasRef.current && !spectrumCollapsed) {
            drawSpectrum(spectrumCanvasRef.current, spectrumData, "RF FFT")
            console.log('Spectrum display updated after frequency change')
          }
          
          // Update waterfall display
          if (waterfallCanvasRef.current && !waterfallCollapsed) {
            // Clear waterfall when frequency changes significantly
            const ctx = waterfallCanvasRef.current.getContext('2d')
            if (ctx) {
              ctx.fillStyle = '#000'
              ctx.fillRect(0, 0, waterfallCanvasRef.current.width, waterfallCanvasRef.current.height)
              drawWaterfall(waterfallCanvasRef.current, spectrumData)
              console.log('Waterfall display updated after frequency change')
            }
          }
          
          // Update IF spectrum
          if (ifSpectrumCanvasRef.current && !ifSpectrumCollapsed) {
            const ifData = spectrumData.slice(400, 624)
            drawSpectrum(ifSpectrumCanvasRef.current, ifData, "IF Spectrum")
            console.log('IF spectrum updated after frequency change')
          }
        }
      } catch (error) {
        console.error('Error updating displays after frequency change:', error)
      }
    }
  }, [centerFrequency, isPlaying, spectrumCollapsed, waterfallCollapsed, ifSpectrumCollapsed, getSpectrumDataForDisplay, drawSpectrum, drawWaterfall])

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
      {/* Connection Instructions */}
      {!isConnected && (
        <div className="bg-blue-900 border-b border-blue-700 p-2 text-center">
          <span className="text-sm">
            📡 RTL-SDR not connected. Click the "C" (Connect) button to pair your device via WebUSB.
          </span>
        </div>
      )}
      
      {isConnected && !isPlaying && (
        <div className="bg-green-900 border-b border-green-700 p-2 text-center">
          <span className="text-sm">
            ✅ RTL-SDR connected. Click the Play button to start receiving.
          </span>
        </div>
      )}
      
      {isConnected && isPlaying && (
        <div className="bg-green-900 border-b border-green-700 p-2 text-center">
          <div className="text-sm">
            🎵 RTL-SDR playing at {(centerFrequency/1e6).toFixed(3)} MHz with {sampleRate/1e6} MSPS
          </div>
          <div className="text-xs mt-1 flex justify-center gap-2">
            <span>Mode: {demodMode}</span>
            <span>Bandwidth: {(bandwidth/1e3).toFixed(1)} kHz</span>
            <span>Volume: {Math.round(volume*100)}%</span>
            <span>Gain: {gain !== null ? gain + ' dB' : 'Auto'}</span>
          </div>
          <div className="flex justify-center gap-2 mt-1">
            <button
              className="text-xs underline text-blue-300"
              onClick={() => {
                const message = `Debug Status:
- Device: ${deviceName} (${deviceStatus})
- Connection: ${isConnected ? 'Connected' : 'Disconnected'}
- Playback: ${isPlaying ? 'Playing' : 'Stopped'}
- Audio Volume: ${volume}
- Frequency: ${(centerFrequency/1e6).toFixed(6)} MHz
- Mode: ${demodMode}
- Sample Rate: ${sampleRate/1e6} MSPS
- Bandwidth: ${bandwidth/1e3} kHz
- Gain: ${gain !== null ? gain + ' dB' : 'Auto'}
- AGC: ${agc ? 'On' : 'Off'}
- PPM: ${ppm}
- DirectSampling: ${directSampling}
- BiasTee: ${biasTee ? 'On' : 'Off'}`

                console.log(message)
                alert(message)
              }}
            >
              Show Debug Info
            </button>
            <button
              className="text-xs underline text-red-300 ml-4"
              onClick={async () => {
                if (confirm("Are you sure you want to reset the RTL-SDR device? This will disconnect and reconnect it.")) {
                  try {
                    console.log("Attempting to reset device...")
                    const success = await resetDevice()
                    if (success) {
                      alert("Device reset successful. Please press Play to restart reception.")
                    } else {
                      alert("Device reset failed. Please try reconnecting manually.")
                    }
                  } catch (error) {
                    console.error("Reset error:", error)
                    alert(`Reset failed: ${error instanceof Error ? error.message : "Unknown error"}`)
                  }
                }
              }}
            >
              Reset Device
            </button>
          </div>
        </div>
      )}
      
      {/* Top Toolbar - SDR# Style */}
      <div className="bg-gray-800 px-2 py-1 flex items-center gap-2 border-b border-gray-600 text-sm min-h-[40px]" style={{ backgroundColor: '#2d2d2d' }}>
        {/* Menu Button */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 h-8 w-8 text-white hover:bg-gray-700"
          >
            <div className="flex flex-col gap-0.5">
              <div className="w-3 h-0.5 bg-white"></div>
              <div className="w-3 h-0.5 bg-white"></div>
              <div className="w-3 h-0.5 bg-white"></div>
            </div>
          </Button>

          {showMenu && (
            <div className="absolute top-8 left-0 bg-gray-800 border border-gray-600 shadow-lg z-50 w-48">
              <div className="py-1">
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-500 rounded-sm flex items-center justify-center text-xs">S</div>
                  Source
                </div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex items-center gap-2">
                  <div className="w-4 h-4 bg-green-500 rounded-sm flex items-center justify-center text-xs">R</div>
                  Radio
                </div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex items-center gap-2">
                  <div className="w-4 h-4 bg-orange-500 rounded-sm flex items-center justify-center text-xs">A</div>
                  AGC
                </div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex items-center gap-2">
                  <div className="w-4 h-4 bg-purple-500 rounded-sm flex items-center justify-center text-xs">A</div>
                  Audio
                </div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-500 rounded-sm flex items-center justify-center text-xs">D</div>
                  Display
                </div>
                <div className="border-t border-gray-600 my-1"></div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer">Layout ▶</div>
              </div>
            </div>
          )}
        </div>

        {/* Control Buttons */}
        {/* Connect Button - Only show if not connected */}
        {!isConnected && (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              try {
                console.log('Connect button clicked')
                await connect()
                console.log('Device connected successfully')
              } catch (error) {
                console.error('Connection failed:', error)
                alert(`Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}\n\nPlease ensure:\n1. RTL-SDR device is plugged in\n2. Click "Connect" to pair via WebUSB\n3. Grant permission when prompted`)
              }
            }}
            className="p-1 h-8 w-8 text-white hover:bg-gray-700 bg-blue-600"
            title="Connect RTL-SDR Device"
          >
            <span className="text-xs font-bold">C</span>
          </Button>
        )}
        
        {/* Reset Button - Always show */}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              if (confirm("Are you sure you want to reset the RTL-SDR device? This will disconnect and reconnect it.")) {
                console.log("Performing full device reset...")
                const success = await resetDevice()
                if (success) {
                  alert("Device reset successful. Please press Play to restart reception.")
                } else {
                  alert("Device reset failed. Please try reconnecting manually.")
                }
              }
            } catch (error) {
              console.error("Reset error:", error)
              alert(`Reset failed: ${error instanceof Error ? error.message : "Unknown error"}`)
            }
          }}
          className="p-1 h-8 w-8 text-white hover:bg-gray-700 bg-red-600"
          title="Reset RTL-SDR Device"
        >
          <span className="text-xs font-bold">R</span>
        </Button>
        
        {/* Sample Rate Button - Cycle through different rates */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // Define common sample rates that work well with RTL-SDR
            const sampleRates = [1024000, 1400000, 1800000, 2048000, 2400000, 2800000, 3200000];
            
            // Find current sample rate in the array
            const currentIndex = sampleRates.indexOf(sampleRate);
            
            // Select next sample rate (or first if current not found or at end)
            const nextIndex = (currentIndex === -1 || currentIndex === sampleRates.length - 1) ? 0 : currentIndex + 1;
            const newSampleRate = sampleRates[nextIndex];
            
            console.log(`Changing sample rate from ${sampleRate/1e6} MSPS to ${newSampleRate/1e6} MSPS`);
            setSampleRate(newSampleRate);
            
            // If we're playing, we need to restart
            if (isPlaying) {
              stop();
              setTimeout(() => {
                play();
              }, 500);
            }
            
            alert(`Sample rate changed to ${newSampleRate/1000} kSPS. This may improve device compatibility.`);
          }}
          className="p-1 h-8 w-8 text-white hover:bg-gray-700 bg-green-600"
          title="Change Sample Rate"
        >
          <span className="text-xs font-bold">S</span>
        </Button>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              // Request audio permissions before playing
              try {
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
                await audioContext.resume()
                console.log('Audio permissions granted')
              } catch (audioError) {
                console.warn('Audio permission request failed:', audioError)
              }
              
              if (isPlaying) {
                stop()
                console.log('Playback stopped')
              } else {
                // Don't auto-connect on play - require explicit connect first
                if (!isConnected) {
                  alert('Please connect your RTL-SDR device first by clicking the "C" (Connect) button.')
                  return
                }
                await play()
                console.log('Playback started')
              }
            } catch (error) {
              console.error('Error toggling playback:', error)
              alert(`Playback error: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }}
          className={`p-1 h-8 w-8 text-white hover:bg-gray-700 ${isConnected ? '' : 'opacity-50'}`}
          disabled={!isConnected}
          title={isConnected ? (isPlaying ? "Stop" : "Start") : "Connect device first"}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </Button>

        <Button 
          variant="ghost" 
          size="sm" 
          className="p-1 h-8 w-8 text-white hover:bg-gray-700"
          onClick={() => {
            console.log('Manual test and diagnostics clicked')
            
            // Display comprehensive status
            let status = 'DIAGNOSTIC REPORT:\n\n';
            
            // Device status
            status += `DEVICE STATUS:\n`;
            status += `- Connected: ${isConnected}\n`;
            status += `- Playing: ${isPlaying}\n`;
            status += `- Device: ${deviceName}\n`;
            status += `- Status: ${deviceStatus}\n\n`;
            
            // Audio status
            status += `AUDIO STATUS:\n`;
            status += `- Volume: ${volume}\n`;
            status += `- Demodulation Mode: ${demodMode}\n`;
            status += `- Bandwidth: ${bandwidth} Hz\n\n`;
            
            // Try to check audio context state
            try {
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
              status += `- Audio Context State: ${audioCtx.state}\n`;
              status += `- Audio Sample Rate: ${audioCtx.sampleRate} Hz\n\n`;
            } catch (e) {
              status += `- Audio Context Error: ${e}\n\n`;
            }
            
            console.log(status);
            
            // Force a single animation frame for testing
            const spectrumData = getSpectrumDataForDisplay()
            
            if (spectrumData) {
              // Get data statistics
              let min = Infinity;
              let max = -Infinity;
              let sum = 0;
              let nonZeroCount = 0;
              
              for (let i = 0; i < spectrumData.length; i++) {
                min = Math.min(min, spectrumData[i]);
                max = Math.max(max, spectrumData[i]);
                sum += spectrumData[i];
                if (spectrumData[i] !== 0) nonZeroCount++;
              }
              
              const avg = sum / spectrumData.length;
              status += `SPECTRUM DATA:\n`;
              status += `- Data Length: ${spectrumData.length} points\n`;
              status += `- Min Value: ${min.toFixed(2)} dB\n`;
              status += `- Max Value: ${max.toFixed(2)} dB\n`;
              status += `- Average: ${avg.toFixed(2)} dB\n`;
              status += `- Non-Zero Values: ${nonZeroCount}\n`;
              status += `- Sample Values: ${Array.from(spectrumData.slice(0, 5)).map(v => v.toFixed(2)).join(', ')}...\n\n`;
              
              console.log(status);
              
              if (waterfallCanvasRef.current) {
                console.log('Drawing waterfall manually')
                drawWaterfall(waterfallCanvasRef.current, spectrumData)
              }
              
              if (spectrumCanvasRef.current) {
                console.log('Drawing spectrum manually') 
                drawSpectrum(spectrumCanvasRef.current, spectrumData, "RF FFT")
              }
              
              // Show statistics in alert
              alert(status);
            } else {
              status += 'No spectrum data available!\n';
              console.log(status);
              alert(status);
            }
          }}
        >
          <Plus className="w-4 h-4" />
        </Button>

        {/* Configure Menu */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowConfigMenu(!showConfigMenu)}
            className="p-1 h-8 w-8 text-white hover:bg-gray-700"
          >
            <Settings className="w-4 h-4" />
          </Button>

          {showConfigMenu && (
            <div className="absolute top-8 left-0 bg-gray-800 border border-gray-600 shadow-lg z-50 w-56">
              <div className="py-1 text-sm">
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer">AIRSPY R2 / Mini</div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer">AIRSPY HF+ Series</div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer">RTL-SDR USB</div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer">HackRF</div>
                <div className="px-3 py-1 hover:bg-gray-700 cursor-pointer">FUNcube Dongle Pro</div>
              </div>
            </div>
          )}
        </div>

        <Button variant="ghost" size="sm" className="p-1 h-8 w-8 text-white hover:bg-gray-700">
          <Volume2 className="w-4 h-4" />
        </Button>
        
        {/* Diagnostic Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              const message = "Running Audio Diagnostic..."
              console.log(message)
              alert(message)
              
              // Try to play a test tone using Web Audio API
              const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
              
              if (audioCtx.state === 'suspended') {
                await audioCtx.resume()
                console.log('Audio context resumed for test')
              }
              
              // Create oscillator for test tone
              const oscillator = audioCtx.createOscillator()
              oscillator.type = 'sine'
              oscillator.frequency.setValueAtTime(1000, audioCtx.currentTime) // 1000 Hz tone
              
              // Create gain node to control volume
              const gainNode = audioCtx.createGain()
              gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime) // 20% volume
              
              // Connect nodes
              oscillator.connect(gainNode)
              gainNode.connect(audioCtx.destination)
              
              // Start and stop after 1 second
              oscillator.start()
              
              // Test RTL-SDR audio system if connected
              if (isConnected) {
                try {
                  console.log("Testing RTL-SDR audio system...")
                  // Force volume to high temporarily
                  setVolume(0.8) // Temporarily boost volume for test
                  
                  setTimeout(() => {
                    // Restore original volume
                    setVolume(volume)
                  }, 2000)
                } catch (rtlError) {
                  console.error("RTL-SDR audio test failed:", rtlError)
                }
              }
              
              setTimeout(() => {
                oscillator.stop()
                alert("Audio test complete. Did you hear a 1-second beep tone? If yes, your audio is working.")
              }, 1000)
            } catch (error) {
              console.error('Audio test error:', error)
              alert(`Audio test failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }}
          className="p-1 h-8 w-8 text-white hover:bg-gray-700 bg-purple-800"
          title="Test Audio"
        >
          <span className="text-xs font-bold">T</span>
        </Button>

        {/* Status Display */}
        <div className="flex items-center gap-2 ml-4">
          <div className={`w-3 h-3 rounded-full ${
            isConnected ? (isPlaying ? 'bg-green-500' : 'bg-yellow-500') : 'bg-red-500'
          }`} title={deviceStatus}></div>
          <span className="text-xs text-gray-300">{deviceName}</span>
          <span className="text-xs text-gray-400">({deviceStatus})</span>
        </div>

        {/* Volume Slider */}
        <div className="w-16">
          <Slider value={[volume]} onValueChange={(v) => setVolume(v[0])} max={100} step={1} className="h-2" />
        </div>

        {/* Frequency Display - SDR# Style */}
        <div className={`flex items-center gap-1 mx-4 bg-black px-3 py-1 rounded border ${frequencyChanging ? 'border-blue-500' : 'border-gray-600'}`}>
          <span className="text-gray-400 text-sm font-mono">000.</span>
          <Input
            type="text"
            value={(centerFrequency / 1000000).toFixed(3)}
            onChange={(e) => {
              const val = Number.parseFloat(e.target.value) * 1000000
              if (!isNaN(val) && val > 0) {
                updateFrequency(val)
                console.log(`Frequency changed via input to ${val} Hz (${val/1e6} MHz)`)
              }
            }}
            onBlur={() => {
              // Force UI update on blur
              const currentFreq = centerFrequency
              console.log(`Ensuring frequency is set to: ${currentFreq} Hz`)
              updateFrequency(currentFreq)
            }}
            className="w-20 bg-transparent border-none text-white text-center text-base font-mono p-0 h-6 focus:ring-0"
            style={{ fontSize: '16px', fontFamily: 'monospace' }}
          />
          <span className="text-gray-400 text-sm font-mono">.000</span>
          <span className="text-gray-300 text-xs ml-1">MHz</span>
        </div>

        {/* Tuning Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="p-1 h-6 w-6 text-white hover:bg-gray-700"
            onClick={() => {
              const newFreq = centerFrequency - 100000 // 100 kHz down
              updateFrequency(newFreq)
              console.log(`Frequency decreased by 100 kHz to ${newFreq} Hz`)
            }}
          >
            <Minus className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="p-1 h-6 w-6 text-white hover:bg-gray-700"
            onClick={() => {
              const newFreq = centerFrequency + 100000 // 100 kHz up
              updateFrequency(newFreq)
              console.log(`Frequency increased by 100 kHz to ${newFreq} Hz`)
            }}
          >
            <Plus className="w-3 h-3" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            className="p-1 h-6 w-6 text-white hover:bg-gray-700"
            onClick={() => {
              // Jump to FM broadcast band (good for testing)
              const fmFreq = 100.1e6 // 100.1 MHz
              updateFrequency(fmFreq)
              console.log(`Frequency reset to FM band: ${fmFreq} Hz`)
            }}
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>

        {/* Scanner Button */}
        <Button
          variant={scanner.enabled ? "default" : "ghost"}
          size="sm"
          onClick={() => setScanner({ enabled: !scanner.enabled })}
          className="p-1 h-8 w-8 text-white hover:bg-gray-700"
        >
          <Scan className="w-4 h-4" />
        </Button>

        {/* Bookmarks */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowBookmarks(!showBookmarks)}
          className="p-1 h-8 w-8 text-white hover:bg-gray-700"
        >
          <Bookmark className="w-4 h-4" />
        </Button>

        {/* Quick Preset Frequencies */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPresetMenu(!showPresetMenu)}
            className="p-1 h-8 w-8 text-white hover:bg-gray-700 bg-blue-700"
            title="Quick Tune Presets"
          >
            <span className="text-xs font-bold">FM</span>
          </Button>

          {showPresetMenu && (
            <div className="absolute top-8 left-0 bg-gray-800 border border-gray-600 shadow-lg z-50 w-48">
              <div className="py-1">
                <div 
                  className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
                  onClick={() => tuneToPreset(88.5e6)}
                >
                  88.5 MHz - FM Radio
                </div>
                <div 
                  className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
                  onClick={() => tuneToPreset(100.1e6)}
                >
                  100.1 MHz - FM Radio
                </div>
                <div 
                  className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
                  onClick={() => tuneToPreset(107.9e6)}
                >
                  107.9 MHz - FM Radio
                </div>
                <div className="border-t border-gray-600 my-1"></div>
                <div 
                  className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
                  onClick={() => tuneToPreset(162.55e6)}
                >
                  162.55 MHz - NOAA Weather
                </div>
                <div 
                  className="px-3 py-1 hover:bg-gray-700 cursor-pointer"
                  onClick={() => tuneToPreset(145.0e6)}
                >
                  145.0 MHz - Amateur Radio
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-4">
          {/* Status indicators */}
          <div className="text-xs text-gray-400">
            <div>Status: {deviceStatus}</div>
            <div>Audio: {isPlaying ? 'ON' : 'OFF'}</div>
            <div>Connected: {isConnected ? 'YES' : 'NO'}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const status = `
DEVICE STATUS:
- Connected: ${isConnected}
- Playing: ${isPlaying}
- Current Frequency: ${(centerFrequency/1e6).toFixed(6)} MHz
- Sample Rate: ${sampleRate/1e3} kHz
- Mode: ${demodMode}
- Gain: ${gain !== null ? gain + ' dB' : 'Auto'}
- Bandwidth: ${bandwidth/1e3} kHz

Try tuning to 100.1 MHz (FM broadcast) for testing.
              `;
              
              alert(status);
              
              // Force frequency update
              updateFrequency(centerFrequency);
            }}
            className="p-1 h-8 w-8 text-white hover:bg-gray-700 bg-yellow-600"
            title="Show Debug Info"
          >
            <span className="text-xs font-bold">?</span>
          </Button>
          <div className="text-gray-400 text-sm font-bold">AIRSPY</div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Control Panel - SDR# Style */}
        <div className="w-64 bg-gray-850 border-r border-gray-600 overflow-y-auto" style={{ backgroundColor: '#1a1a1a' }}>
          {/* Source */}
          <div className="p-3 border-b border-gray-700">
            <Label className="text-xs text-gray-300 mb-2 block font-semibold">Source</Label>
            <Select defaultValue="rtl-sdr">
              <SelectTrigger className="bg-gray-800 border-gray-600 text-white text-xs h-7 rounded">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-600">
                <SelectItem value="rtl-sdr">RTL-SDR USB</SelectItem>
                <SelectItem value="hackrf">HackRF</SelectItem>
                <SelectItem value="airspy">AIRSPY</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Radio */}
          <div className="p-3 border-b border-gray-700">
            <Label className="text-xs text-gray-300 mb-2 block font-semibold">Radio</Label>

            {/* Demod Modes - SDR# Style Grid */}
            <div className="grid grid-cols-4 gap-1 mb-3">
              {["NBFM", "AM", "LSB", "USB", "WBFM", "DSB", "CW", "RAW"].map((mode) => (
                <Button
                  key={mode}
                  variant={demodMode === mode ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    try {
                      console.log(`Setting demod mode to ${mode}`);
                      setDemodMode(mode);
                      
                      // If we're on FM broadcast frequencies, set appropriate bandwidth
                      if (mode === "WBFM" && centerFrequency >= 88e6 && centerFrequency <= 108e6) {
                        setBandwidth(200000); // 200 kHz for FM broadcast
                      } else if (mode === "NBFM") {
                        setBandwidth(12500); // 12.5 kHz for NFM
                      } else if (mode === "AM") {
                        setBandwidth(10000); // 10 kHz for AM
                      }
                    } catch (error) {
                      console.error('Error setting demod mode:', error)
                    }
                  }}
                  className={`text-xs h-6 rounded transition-colors ${
                    demodMode === mode
                      ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-500"
                      : "bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-600"
                  }`}
                >
                  {mode === "NBFM" ? "NFM" : mode === "WBFM" ? "WFM" : mode}
                </Button>
              ))}
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <Label className="text-gray-300 w-12">Filter</Label>
                <Select defaultValue="blackman">
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-white text-xs h-5 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-600">
                    <SelectItem value="blackman">Blackman-Harris 4</SelectItem>
                    <SelectItem value="hamming">Hamming</SelectItem>
                    <SelectItem value="hann">Hann</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-gray-300 w-12">BW</Label>
                <Input
                  type="number"
                  value={bandwidth}
                  onChange={(e) => setBandwidth(Number.parseInt(e.target.value))}
                  className="bg-gray-800 border-gray-600 text-white text-xs h-5 flex-1"
                />
              </div>

              <div className="flex items-center gap-2">
                <Label className="text-gray-300 w-12">Shift</Label>
                <Input
                  type="number"
                  defaultValue={0}
                  className="bg-gray-800 border-gray-600 text-white text-xs h-5 flex-1"
                />
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <div className="flex items-center space-x-2">
                <Checkbox id="squelch-enable" className="border-gray-600 h-3 w-3" />
                <Label htmlFor="squelch-enable" className="text-xs text-gray-300">
                  Squelch
                </Label>
              </div>
              <Slider
                defaultValue={[-50]}
                max={-10}
                min={-100}
                step={1}
                className="w-full h-2"
              />
              <div className="text-xs text-gray-400">-50 dB</div>
            </div>
          </div>

          {/* AGC Controls - Fixed */}
          <div className="p-3 border-b border-gray-700">
            <Label className="text-xs text-gray-300 mb-2 block font-semibold">AGC</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="agc" 
                  checked={agc} 
                  onCheckedChange={(checked) => setAgc(checked === true)} 
                  className="border-gray-600 h-4 w-4" 
                />
                <Label htmlFor="agc" className="text-xs text-gray-300">
                  AGC Enabled
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="use-hang"
                  checked={useHang}
                  onCheckedChange={(checked) => setUseHang(checked === true)}
                  className="border-gray-600 h-4 w-4"
                />
                <Label htmlFor="use-hang" className="text-xs text-gray-300">
                  Use Hang
                </Label>
              </div>
            </div>
          </div>

          {/* Audio Controls - Fixed */}
          <div className="p-3 border-b border-gray-700">
            <Label className="text-xs text-gray-300 mb-2 block font-semibold">Audio</Label>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <Label className="text-gray-300 w-16">Samplerate</Label>
                <Select defaultValue="48000">
                  <SelectTrigger className="bg-gray-800 border-gray-600 text-white text-xs h-6 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-600">
                    <SelectItem value="48000">48000</SelectItem>
                    <SelectItem value="44100">44100</SelectItem>
                    <SelectItem value="22050">22050</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-gray-300">Volume</Label>
                  <span className="text-xs text-gray-400">{Math.round(volume * 100)}%</span>
                </div>
                <Slider
                  value={[volume * 100]}
                  onValueChange={(v) => setVolume(v[0] / 100)}
                  max={100}
                  min={0}
                  step={1}
                  className="w-full h-2"
                />
              </div>
            </div>
          </div>

          {/* Scanner */}
          {scanner.enabled && (
            <div className="p-2 border-b border-gray-700">
              <Label className="text-xs text-gray-300 mb-2 block">Scanner</Label>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <Label className="text-gray-300 w-12">Start</Label>
                  <Input
                    type="number"
                    value={scanner.startFreq}
                    onChange={(e) => setScanner({ startFreq: Number.parseInt(e.target.value) })}
                    className="bg-gray-800 border-gray-600 text-white text-xs h-5 flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-gray-300 w-12">End</Label>
                  <Input
                    type="number"
                    value={scanner.endFreq}
                    onChange={(e) => setScanner({ endFreq: Number.parseInt(e.target.value) })}
                    className="bg-gray-800 border-gray-600 text-white text-xs h-5 flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-gray-300 w-12">Step</Label>
                  <Input
                    type="number"
                    value={scanner.stepSize}
                    onChange={(e) => setScanner({ stepSize: Number.parseInt(e.target.value) })}
                    className="bg-gray-800 border-gray-600 text-white text-xs h-5 flex-1"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-gray-300 w-12">Speed</Label>
                  <Slider
                    value={[scanner.speed]}
                    onValueChange={(v) => setScanner({ speed: v[0] })}
                    max={5000}
                    min={100}
                    step={100}
                    className="flex-1 h-2"
                  />
                  <span className="text-xs text-gray-400 w-12">{scanner.speed}ms</span>
                </div>
              </div>
            </div>
          )}

          {/* RF Controls - Fixed */}
          <div className="p-3 border-b border-gray-700">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-gray-300 font-semibold">
                  RF Gain: {gain !== null ? `${gain} dB` : 'Auto'}
                </Label>
              </div>
              <Slider
                value={[gain !== null ? gain : 0]}
                onValueChange={(v) => setGain(v[0] === 0 ? null : v[0])}
                max={50}
                min={0}
                step={1}
                className="w-full h-2"
              />
              <div className="flex items-center space-x-2 mt-3">
                <Checkbox
                  id="bias-tee"
                  checked={biasTee}
                  onCheckedChange={(checked) => setBiasTee(checked === true)}
                  className="border-gray-600 h-4 w-4"
                />
                <Label htmlFor="bias-tee" className="text-xs text-gray-300">
                  Bias Tee
                </Label>
              </div>
            </div>
          </div>

          {/* Corrections - Fixed */}
          <div className="p-3 border-b border-gray-700">
            <Label className="text-xs text-gray-300 mb-2 block font-semibold">Corrections</Label>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <Label className="text-gray-300 w-16">PPM</Label>
                <Input
                  type="number"
                  value={ppm}
                  onChange={(e) => {
                    const value = Number.parseInt(e.target.value) || 0
                    setPpm(value)
                  }}
                  className="bg-gray-800 border-gray-600 text-white text-xs h-6 flex-1"
                  placeholder="0"
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="freq-shift"
                  checked={frequencyShift}
                  onCheckedChange={(checked) => setFrequencyShift(checked === true)}
                  className="border-gray-600 h-4 w-4"
                />
                <Label htmlFor="freq-shift" className="text-xs text-gray-300">
                  Frequency Shift
                </Label>
              </div>
            </div>
          </div>

          {/* Bookmarks */}
          {showBookmarks && (
            <div className="p-2 border-b border-gray-700">
              <Label className="text-xs text-gray-300 mb-2 block">Bookmarks</Label>
              <div className="space-y-1">
                <div className="flex gap-1">
                  <Input
                    type="text"
                    placeholder="Name"
                    value={newBookmarkName}
                    onChange={(e) => setNewBookmarkName(e.target.value)}
                    className="bg-gray-800 border-gray-600 text-white text-xs h-5 flex-1"
                  />
                  <Button size="sm" onClick={handleAddBookmark} className="h-5 px-2 text-xs">
                    Add
                  </Button>
                </div>
                <div className="max-h-32 overflow-y-auto">
                  {bookmarks && bookmarks.length > 0 ? bookmarks.map((bookmark, index) => (
                    <div key={index} className="flex items-center justify-between py-1">
                      <button
                        onClick={() => {
                          try {
                            setFrequency(bookmark.frequency)
                            setDemodMode(bookmark.mode)
                          } catch (error) {
                            console.error('Error setting bookmark:', error)
                          }
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 flex-1 text-left"
                      >
                        {bookmark.name} - {(bookmark.frequency / 1000000).toFixed(3)}MHz
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          try {
                            removeBookmark(index)
                          } catch (error) {
                            console.error('Error removing bookmark:', error)
                          }
                        }}
                        className="h-4 w-4 p-0 text-red-400 hover:text-red-300"
                      >
                        ×
                      </Button>
                    </div>
                  )) : (
                    <div className="text-xs text-gray-400 py-2">No bookmarks</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Main Display Area */}
        <div className="flex-1 flex flex-col bg-black">
          {/* Spectrum Analyzer */}
          <div className={`${spectrumCollapsed ? 'h-8' : 'h-1/3'} bg-black border-b border-gray-800 relative transition-all duration-200`}>
            <div className="absolute top-0 left-0 right-0 h-8 bg-gray-800 bg-opacity-50 flex items-center px-2 z-10 cursor-pointer"
                 onClick={() => setSpectrumCollapsed(!spectrumCollapsed)}>
              <div className="text-xs text-yellow-400 flex-1">Spectrum {spectrumCollapsed ? '▶' : '▼'}</div>
            </div>
            <canvas
              ref={spectrumCanvasRef}
              width={1024}
              height={200}
              className="w-full h-full cursor-crosshair"
              onClick={handleCanvasClick}
              onDoubleClick={handleCanvasDoubleClick}
              onWheel={handleCanvasWheel}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseLeave}
            />
          </div>

          {/* Waterfall Display */}
          <div className={`${waterfallCollapsed ? 'h-8' : 'h-1/3'} bg-black border-b border-gray-800 relative transition-all duration-200`}>
            <div className="absolute top-0 left-0 right-0 h-8 bg-gray-800 bg-opacity-50 flex items-center px-2 z-10 cursor-pointer"
                 onClick={() => setWaterfallCollapsed(!waterfallCollapsed)}>
              <div className="text-xs text-yellow-400 flex-1">Waterfall {waterfallCollapsed ? '▶' : '▼'}</div>
            </div>
            <canvas
              ref={waterfallCanvasRef}
              width={1024}
              height={200}
              className="w-full h-full cursor-crosshair"
              onClick={handleCanvasClick}
              onDoubleClick={handleCanvasDoubleClick}
              onWheel={handleCanvasWheel}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseLeave}
            />
          </div>

          {/* IF Spectrum */}
          <div className={`${ifSpectrumCollapsed ? 'h-8' : 'h-1/3'} bg-black border-b border-gray-800 relative transition-all duration-200 flex-1`}>
            <div className="absolute top-0 left-0 right-0 h-8 bg-gray-800 bg-opacity-50 flex items-center px-2 z-10 cursor-pointer"
                 onClick={() => setIfSpectrumCollapsed(!ifSpectrumCollapsed)}>
              <div className="text-xs text-yellow-400 flex-1">IF Spectrum {ifSpectrumCollapsed ? '▶' : '▼'}</div>
            </div>
            <canvas
              ref={ifSpectrumCanvasRef}
              width={1024}
              height={200}
              className="w-full h-full cursor-crosshair"
              onClick={handleCanvasClick}
              onDoubleClick={handleCanvasDoubleClick}
              onWheel={handleCanvasWheel}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseLeave}
            />
          </div>
        </div>

        {/* Right Control Panel - SDR# Style */}
        <div className="w-20 bg-gray-800 p-2 border-l border-gray-700 flex flex-col items-center space-y-6" style={{ backgroundColor: '#1a1a1a' }}>
          {/* Zoom Control */}
          <div className="flex flex-col items-center">
            <Label className="text-xs font-medium mb-2 text-gray-300 writing-mode-vertical">Zoom</Label>
            <div className="h-32 flex flex-col items-center">
              <Slider
                orientation="vertical"
                value={[zoom]}
                onValueChange={(v) => setZoom(v[0])}
                max={100}
                min={1}
                step={1}
                className="h-24 mb-2"
              />
              <div className="text-xs text-center text-gray-400 bg-gray-900 px-1 rounded">{zoom.toFixed(1)}</div>
            </div>
          </div>

          {/* Contrast Control */}
          <div className="flex flex-col items-center">
            <Label className="text-xs font-medium mb-2 text-gray-300">Contrast</Label>
            <div className="h-32 flex flex-col items-center">
              <Slider
                orientation="vertical"
                value={[contrast.min * -1]}
                onValueChange={(v) => setContrast(v[0] * -1, contrast.max)}
                max={100}
                min={0}
                step={1}
                className="h-24 mb-2"
              />
              <div className="text-xs text-center text-gray-400 bg-gray-900 px-1 rounded">{Math.abs(contrast.min)}</div>
            </div>
          </div>

          {/* Range Control */}
          <div className="flex flex-col items-center">
            <Label className="text-xs font-medium mb-2 text-gray-300">Range</Label>
            <div className="h-32 flex flex-col items-center">
              <Slider
                orientation="vertical"
                value={[range.min * -1]}
                onValueChange={(v) => setRange(v[0] * -1, range.max)}
                max={100}
                min={10}
                step={1}
                className="h-24 mb-2"
              />
              <div className="text-xs text-center text-gray-400 bg-gray-900 px-1 rounded">{Math.abs(range.min)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
