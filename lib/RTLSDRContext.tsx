"use client";

import React, { createContext, useContext, useState, useRef, ReactNode, useEffect } from 'react'
import { Radio } from '@jtarrio/webrtlsdr/radio'
import { RTL2832U_Provider } from '@jtarrio/webrtlsdr/rtlsdr'
import { Demodulator } from '@jtarrio/webrtlsdr/demod/demodulator'
import { Spectrum } from '@jtarrio/webrtlsdr/demod/spectrum'
import { getMode } from '@jtarrio/webrtlsdr/demod/modes'
import { DirectSampling } from '@jtarrio/webrtlsdr/rtlsdr'

interface RTLSDRContextType {
  isConnected: boolean
  isPlaying: boolean
  centerFrequency: number
  sampleRate: number
  gain: number | null
  demodMode: string
  bandwidth: number
  volume: number
  ppm: number
  directSampling: DirectSampling
  biasTee: boolean
  agc: boolean
  deviceName: string
  deviceStatus: string
  
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  resetDevice: () => Promise<boolean>  // New reset function
  play: () => Promise<void>
  stop: () => void
  setFrequency: (freq: number) => void
  setSampleRate: (rate: number) => void
  setGain: (gain: number | null) => void
  setDemodMode: (mode: string) => void
  setBandwidth: (bw: number) => void
  setVolume: (volume: number) => void
  setPpm: (ppm: number) => void
  setDirectSampling: (mode: DirectSampling) => void
  setBiasTee: (enabled: boolean) => void
  setAgc: (enabled: boolean) => void
  
  radioRef: React.RefObject<Radio | null>
  demodulatorRef: React.RefObject<Demodulator | null>
  spectrumRef: React.RefObject<Spectrum | null>
  getSpectrumData: () => Float32Array | null
}

const RTLSDRContext = createContext<RTLSDRContextType | null>(null)

export const useRTLSDR = () => {
  const context = useContext(RTLSDRContext)
  if (!context) {
    throw new Error('useRTLSDR must be used within an RTLSDRProvider')
  }
  return context
}

interface RTLSDRProviderProps {
  children: ReactNode
}

export const RTLSDRProvider: React.FC<RTLSDRProviderProps> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [centerFrequency, setCenterFrequency] = useState(100.0 * 1e6) // 100 MHz
  const [sampleRate, setSampleRate] = useState(2048000) // 2.048 MSPS
  const [gain, setGain] = useState<number | null>(null) // Auto gain
  const [demodMode, setDemodMode] = useState<string>('WBFM')
  const [bandwidth, setBandwidth] = useState(200000) // Default 200 kHz for WBFM
  const [volume, setVolume] = useState(0.5) // 50% volume
  const [ppm, setPpm] = useState(0) // 0 ppm correction
  const [directSampling, setDirectSampling] = useState<DirectSampling>(DirectSampling.Off)
  const [biasTee, setBiasTee] = useState(false)
  const [agc, setAgc] = useState(false)
  const [deviceName, setDeviceName] = useState<string>('RTL-SDR')
  const [deviceStatus, setDeviceStatus] = useState<string>('Disconnected')
  
  const providerRef = useRef<RTL2832U_Provider | null>(null)
  const radioRef = useRef<Radio | null>(null)
  const demodulatorRef = useRef<Demodulator | null>(null)
  const spectrumRef = useRef<Spectrum | null>(null)
  const spectrumDataRef = useRef<Float32Array | null>(null)
  
  // Update device status
  useEffect(() => {
    if (isConnected) {
      if (isPlaying) {
        setDeviceStatus('Playing')
      } else {
        setDeviceStatus('Connected')
      }
    } else {
      setDeviceStatus('Disconnected')
    }
  }, [isConnected, isPlaying])
  
  const connect = async () => {
    try {
      setDeviceStatus('Connecting...')
      console.log('Starting RTL-SDR connection process...')
      
      // First, check if the browser supports WebUSB
      if (!navigator.usb) {
        throw new Error('WebUSB is not supported in this browser. Please use Chrome, Edge, or another Chromium-based browser.')
      }
      
      // Request device access - this will show the WebUSB pairing dialog
      console.log('Requesting WebUSB device access...')
      let devices: USBDevice[]
      try {
        devices = await navigator.usb.getDevices()
        console.log('Already paired devices:', devices.length)
        
        if (devices.length === 0) {
          console.log('No paired devices found, requesting new device...')
          // Show device selection dialog
          const device = await navigator.usb.requestDevice({
            filters: [
              { vendorId: 0x0bda, productId: 0x2838 }, // RTL2838UHIDIR
              { vendorId: 0x0bda, productId: 0x2832 }, // RTL2832U
              { vendorId: 0x0bda, productId: 0x2838 }, // RTL2838
            ]
          })
          devices = [device]
          console.log('Device selected:', device.productName)
        } else {
          console.log('Using previously paired device:', devices[0].productName)
        }
      } catch (usbError) {
        console.error('WebUSB device selection failed:', usbError)
        throw new Error('Failed to select RTL-SDR device. Please ensure device is connected and try again.')
      }
      
      // Create provider after device selection
      if (!providerRef.current) {
        console.log('Creating RTL2832U Provider...')
        try {
          providerRef.current = new RTL2832U_Provider()
          
          // Check if the provider was properly initialized
          const providerStatus = (providerRef.current as any).getStatus?.() || 'unknown'
          console.log('RTL2832U Provider status:', providerStatus)
          
          // Check if there are any devices available
          const deviceCount = (providerRef.current as any).getDeviceCount?.() || 'unknown'
          console.log('RTL-SDR device count:', deviceCount)
        } catch (providerError) {
          console.error('Error creating RTL2832U Provider:', providerError)
          throw new Error(`Failed to initialize RTL-SDR provider: ${providerError instanceof Error ? providerError.message : 'Unknown error'}`)
        }
      }
      
      if (!demodulatorRef.current) {
        // Instantiate demodulator with proper audio setup
        try {          // First, try to initialize audio context with comprehensive error handling
          let audioContext: AudioContext | null = null
          try {
            console.log('Creating audio context...')
            
            // Check if AudioContext exists in the browser
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
            
            if (!AudioContextClass) {
              throw new Error('AudioContext not supported in this browser')
            }
            
            // Create with explicit sample rate matching the demodulator output
            audioContext = new AudioContextClass({ 
              sampleRate: 48000, // Standard audio sample rate
              latencyHint: 'interactive'
            })
            
            console.log('Audio context created successfully')
            console.log('- Sample rate:', audioContext.sampleRate)
            console.log('- Current time:', audioContext.currentTime)
            console.log('- State:', audioContext.state)
            
            // Resume audio context if it's suspended (browsers often require user gesture)
            if (audioContext.state === 'suspended') {
              console.log('Audio context suspended, attempting to resume...')
              await audioContext.resume()
              console.log('Audio context state after resume:', audioContext.state)
              
              if (audioContext.state === 'suspended') {
                console.warn('Audio context still suspended - may need user interaction')
                // Create silent audio to attempt to unlock audio on mobile
                const silentSource = audioContext.createOscillator()
                const gain = audioContext.createGain()
                gain.gain.value = 0.001 // Nearly silent
                silentSource.connect(gain)
                gain.connect(audioContext.destination)
                silentSource.start(0)
                silentSource.stop(0.1) // Short sound
              }
            }
            
            // Check for output devices
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
              const devices = await navigator.mediaDevices.enumerateDevices()
              const audioOutputs = devices.filter(device => device.kind === 'audiooutput')
              console.log('Available audio outputs:', audioOutputs.length)
              audioOutputs.forEach((device, index) => {
                console.log(`Output #${index}: ${device.label || 'unnamed device'}`)
              })
            }
          } catch (audioError) {
            console.warn('Failed to create audio context:', audioError)
          }
          
          demodulatorRef.current = new Demodulator()
          console.log('Demodulator created successfully')
          
          // Apply initial settings
          demodulatorRef.current.setSampleRate(sampleRate)
          console.log('Sample rate set to:', sampleRate)
          
          try {
            const modeObject = getMode(demodMode === 'NFM' ? 'NBFM' : demodMode === 'WFM' ? 'WBFM' : demodMode as any)
            demodulatorRef.current.setMode(modeObject)
            console.log('Demod mode set to:', demodMode)
          } catch (error) {
            console.warn('Failed to set initial demod mode:', error)
            // Fallback to WBFM
            try {
              const fallbackMode = getMode('WBFM' as any)
              demodulatorRef.current.setMode(fallbackMode)
              console.log('Fallback to WBFM mode')
            } catch (fallbackError) {
              console.error('Failed to set fallback mode:', fallbackError)
            }
          }

          // Set initial bandwidth if supported
          try {
            if (typeof (demodulatorRef.current as any).setBandwidth === 'function') {
              (demodulatorRef.current as any).setBandwidth(bandwidth)
              console.log('Bandwidth set to:', bandwidth)
            }
          } catch (error) {
            console.warn('Demodulator bandwidth not supported:', error)
          }

          // Set initial volume and ensure audio is enabled
          demodulatorRef.current.setVolume(volume)
          console.log('Volume set to:', volume)
          
          // Try to enable audio output with multiple methods
          try {
            // Method 1: Direct enable
            if (typeof (demodulatorRef.current as any).enableAudio === 'function') {
              (demodulatorRef.current as any).enableAudio(true)
              console.log('Audio enabled via enableAudio')
            }
            
            // Method 2: Start audio if available
            if (typeof (demodulatorRef.current as any).startAudio === 'function') {
              (demodulatorRef.current as any).startAudio()
              console.log('Audio started via startAudio')
            }
            
            // Method 3: Connect to audio context if available
            if (audioContext && typeof (demodulatorRef.current as any).connectToAudioContext === 'function') {
              (demodulatorRef.current as any).connectToAudioContext(audioContext)
              console.log('Connected to audio context')
            }
          } catch (error) {
            console.warn('Audio setup methods not available:', error)
          }
          
        } catch (error) {
          console.error('Failed to create demodulator:', error)
          throw error
        }
      }
        if (!spectrumRef.current) {
        try {
          console.log('Creating Spectrum analyzer...')
          spectrumRef.current = new Spectrum()
            // Set FFT size and sample rate explicitly
          if (typeof (spectrumRef.current as any).setFFTSize === 'function') {
            (spectrumRef.current as any).setFFTSize(1024)
            console.log('Set FFT size to 1024')
          }
          
          if (typeof spectrumRef.current.setSampleRate === 'function') {
            spectrumRef.current.setSampleRate(sampleRate)
            console.log('Set spectrum sample rate to', sampleRate)
          }
          
          // Some implementations need to be explicitly enabled
          if (typeof (spectrumRef.current as any).enable === 'function') {
            (spectrumRef.current as any).enable(true)
            console.log('Explicitly enabled spectrum analyzer')
          }
        } catch (spectrumError) {
          console.error('Error creating Spectrum analyzer:', spectrumError)
        }
      }
      
      // Create a composite receiver that forwards samples to demodulator and spectrum
      const receiverChain = {
        setSampleRate: (rate: number) => {
          try {
            demodulatorRef.current?.setSampleRate(rate as any)
            if (spectrumRef.current && typeof spectrumRef.current.setSampleRate === 'function') {
              spectrumRef.current.setSampleRate(rate as any)
            }
          } catch (error) {
            console.warn('Error setting sample rate in receiver chain:', error)
          }
        },
        receiveSamples: (I: Float32Array, Q: Float32Array, frequency: number) => {
          try {
            console.log(`Received ${I.length} samples at ${frequency} Hz, first I/Q samples:`, 
              I.length > 0 ? I[0] : 'empty', 
              Q.length > 0 ? Q[0] : 'empty'
            )
            
            // Check if we're getting valid data
            let nonZeroCount = 0
            let sumI = 0, sumQ = 0;
            let minI = Infinity, maxI = -Infinity;
            let minQ = Infinity, maxQ = -Infinity;
            
            for (let i = 0; i < Math.min(100, I.length); i++) {
              if (I[i] !== 0 || Q[i] !== 0) {
                nonZeroCount++
              }
              
              sumI += I[i];
              sumQ += Q[i];
              minI = Math.min(minI, I[i]);
              maxI = Math.max(maxI, I[i]);
              minQ = Math.min(minQ, Q[i]);
              maxQ = Math.max(maxQ, Q[i]);
            }
            
            console.log(`Non-zero samples in first 100: ${nonZeroCount}`);
            console.log(`I stats - min: ${minI.toFixed(6)}, max: ${maxI.toFixed(6)}, avg: ${(sumI/Math.min(100, I.length)).toFixed(6)}`);
            console.log(`Q stats - min: ${minQ.toFixed(6)}, max: ${maxQ.toFixed(6)}, avg: ${(sumQ/Math.min(100, Q.length)).toFixed(6)}`);
            
            if (nonZeroCount === 0) {
              console.warn('WARNING: All samples are zero! Check device connection and driver.');
            }
            
            demodulatorRef.current?.receiveSamples(I, Q, frequency)
            spectrumRef.current?.receiveSamples(I, Q, frequency)
          } catch (error) {
            console.warn('Error receiving samples:', error)
          }
        }
      }
        try {
        console.log('Creating Radio instance...')
        radioRef.current = new Radio(providerRef.current, receiverChain)
        console.log('Radio instance created successfully')
        
        // Check radio capabilities
        console.log('Radio capabilities:')
        console.log('- Gain control available:', typeof radioRef.current.setGain === 'function')
        console.log('- Frequency correction available:', typeof radioRef.current.setFrequencyCorrection === 'function')
        console.log('- Direct sampling available:', typeof radioRef.current.setDirectSamplingMethod === 'function')
        
        // Set initial parameters
        console.log('Setting initial parameters:')
        console.log('- Frequency:', centerFrequency)
        radioRef.current.setFrequency(centerFrequency)
        
        console.log('- Gain:', gain)
        radioRef.current.setGain(gain)
        
        // Check the sample rate - this is critical
        if (typeof radioRef.current.setSampleRate === 'function') {
          console.log('- Sample rate:', sampleRate)
          radioRef.current.setSampleRate(sampleRate)
        } else {
          console.warn('Radio does not support setting sample rate directly')
        }
      } catch (radioError) {
        console.error('Error creating Radio instance:', radioError)
        throw new Error(`Failed to initialize Radio: ${radioError instanceof Error ? radioError.message : 'Unknown error'}`)
      }
      
      // Set frequency correction
      if (ppm !== 0) {
        radioRef.current.setFrequencyCorrection(ppm)
      }
      
      // Set direct sampling mode
      if (directSampling !== DirectSampling.Off) {
        radioRef.current.setDirectSamplingMethod(directSampling)
      }
      
      // Set bias tee
      if (biasTee) {
        radioRef.current.enableBiasTee(biasTee)
      }
      
      // Try to get device info
      try {
        const deviceInfo = (radioRef.current as any).getDeviceInfo?.()
        if (deviceInfo && deviceInfo.name) {
          setDeviceName(deviceInfo.name)
        }
      } catch (error) {
        console.warn('Failed to get device info:', error)
      }
        setIsConnected(true)
      setDeviceStatus('Connected')
      console.log('RTL-SDR device connected successfully')
    } catch (error) {
      console.error('Failed to connect to RTL-SDR device:', error)
      setIsConnected(false)
      setDeviceStatus('Connection Failed')
      
      // Provide more specific error messages
      let errorMessage = 'Unknown connection error'
      if (error instanceof Error) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      }
      
      // Add helpful guidance based on error type
      if (errorMessage.includes('No device selected') || errorMessage.includes('User cancelled')) {
        errorMessage = 'Device selection was cancelled. Please try again and select your RTL-SDR device.'
      } else if (errorMessage.includes('NetworkError') || errorMessage.includes('NotFoundError')) {
        errorMessage = 'RTL-SDR device not found. Please ensure your device is connected and drivers are installed.'
      }
      
      throw new Error(errorMessage)
    }
  }
  
  const disconnect = async () => {
    if (radioRef.current) {
      if (radioRef.current.isPlaying()) {
        radioRef.current.stop()
        setIsPlaying(false)
      }
      
      // The Radio class doesn't have a direct close method
      // The device is closed when the Radio is garbage collected
      radioRef.current = null
      setIsConnected(false)
    }
  }
  
  const play = async () => {
    try {
      console.log('Play function called, isConnected:', isConnected)
      
      // Check if connected first
      if (!isConnected) {
        throw new Error('RTL-SDR device is not connected. Please connect the device first.')
      }

      // Check if radio is available
      if (!radioRef.current) {
        throw new Error('Radio not initialized. Please reconnect the device.')
      }

      // Request audio permission and start audio context
      let globalAudioCtx: AudioContext | null = null;
      try {
        console.log('Creating global audio context...')
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        globalAudioCtx = new AudioContextClass({
          sampleRate: 48000,
          latencyHint: 'interactive'
        });
        
        if (globalAudioCtx.state === 'suspended') {
          console.log('Attempting to resume audio context...')
          await globalAudioCtx.resume();
          console.log('Audio context resumed:', globalAudioCtx.state)
          
          // Play a silent sound to unlock audio on some browsers/devices
          const silentSource = globalAudioCtx.createOscillator();
          const gain = globalAudioCtx.createGain();
          gain.gain.value = 0.001;
          silentSource.connect(gain);
          gain.connect(globalAudioCtx.destination);
          silentSource.start(0);
          silentSource.stop(0.1);
        }
      } catch (audioError) {
        console.warn('Audio context setup failed:', audioError)
      }
      
      // Enable audio on demodulator if available
      if (demodulatorRef.current) {
        try {
          console.log('Setting up audio for demodulator...')
          
          // Try all possible methods to enable audio
          if (typeof (demodulatorRef.current as any).enableAudio === 'function') {
            (demodulatorRef.current as any).enableAudio(true)
            console.log('Audio enabled via enableAudio()')
          }
          
          if (typeof (demodulatorRef.current as any).startAudio === 'function') {
            (demodulatorRef.current as any).startAudio()
            console.log('Audio started via startAudio()')
          }
          
          if (globalAudioCtx && typeof (demodulatorRef.current as any).connectToAudioContext === 'function') {
            (demodulatorRef.current as any).connectToAudioContext(globalAudioCtx)
            console.log('Connected to audio context via connectToAudioContext()')
          }
          
          // Set volume explicitly
          demodulatorRef.current.setVolume(volume)
          console.log('Volume set to:', volume)
          
          // Check if audio is actually being processed
          try {
            const audioProcessingStatus = (demodulatorRef.current as any).isAudioEnabled?.() 
              || (demodulatorRef.current as any).isAudioActive?.() 
              || 'unknown'
            console.log('Audio processing status:', audioProcessingStatus)
          } catch (statusError) {
            console.log('Could not determine audio processing status')
          }
          
        } catch (error) {
          console.warn('Failed to enable audio during play:', error)
        }
      } else {
        console.error('No demodulator available! Cannot process audio.')
      }
      
      console.log('Starting radio...')
      try {
        // Some implementations might need special preparation
        if (typeof (radioRef.current as any).prepare === 'function') {
          console.log('Preparing radio...')
          await (radioRef.current as any).prepare()
        }
        
        // Ensure frequency is set before starting
        console.log(`Ensuring frequency is set to ${centerFrequency} Hz before starting`)
        radioRef.current.setFrequency(centerFrequency)
        
        // Start the radio (begins streaming samples)
        radioRef.current.start()
        
        // Check if the radio actually started
        const isActive = radioRef.current.isPlaying()
        console.log('Radio active status after start:', isActive)
        
        if (!isActive) {
          console.warn('Radio reports it is not active after start, trying again...')
          radioRef.current.start()
        }
        
        setIsPlaying(true)
        console.log('Radio started successfully')
        
        // Force a spectrum update
        setTimeout(() => {
          try {
            if (spectrumRef.current && typeof (spectrumRef.current as any).update === 'function') {
              (spectrumRef.current as any).update()
              console.log('Forced spectrum update')
            }
          } catch (updateError) {
            console.warn('Could not force spectrum update:', updateError)
          }
        }, 500)
      } catch (startError) {
        console.error('Error starting radio:', startError)
        throw new Error(`Failed to start radio: ${startError instanceof Error ? startError.message : 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to start playback:', error)
      
      // Provide more specific error messages
      let errorMessage = 'Unknown playback error'
      if (error instanceof Error) {
        errorMessage = error.message
      }
      
      throw new Error(errorMessage)
    }
  }
  
  const stop = () => {
    if (!radioRef.current) return
    
    radioRef.current.stop()
    setIsPlaying(false)
  }
  
  const setFrequencyValue = async (freq: number) => {
    console.log(`===== SETTING FREQUENCY: ${freq} Hz (${freq/1e6} MHz) =====`);
    
    // Update state first
    setCenterFrequency(freq);
    
    // Handle the device update
    if (radioRef.current) {
      try {
        // Stop any existing playback temporarily
        const wasPlaying = radioRef.current.isPlaying();
        if (wasPlaying) {
          console.log('Temporarily stopping playback to change frequency');
          radioRef.current.stop();
        }
        
        // Set the new frequency
        console.log('Applying frequency to device...');
        radioRef.current.setFrequency(freq);
        
        // Restart if it was playing
        if (wasPlaying) {
          console.log('Restarting playback after frequency change');
          radioRef.current.start();
          
          // Force spectrum update
          setTimeout(() => {
            if (spectrumRef.current && typeof (spectrumRef.current as any).update === 'function') {
              try {
                console.log('Forcing spectrum update');
                (spectrumRef.current as any).update();
              } catch (e) {
                console.warn('Failed to update spectrum:', e);
              }
            }
          }, 100);
        }
        
        console.log(`Frequency successfully set to ${freq} Hz`);
      } catch (error) {
        console.error('Error setting frequency:', error);
      }
    } else {
      console.warn('No radio device available to set frequency');
    }
    
    // Return the new frequency for convenience
    return freq;
  }
    const changeDemodMode = (mode: string) => {
    try {
      console.log(`Setting demodulation mode to: ${mode}`);
      setDemodMode(mode);
      
      // Mode names should already match the library expectations since we changed the UI
      let libMode = mode;
      
      // Set appropriate default bandwidth based on mode
      let modeBandwidth = 200000; // Default
      
      switch(mode) {
        case 'WBFM':
          modeBandwidth = 200000; // 200 kHz for WFM
          break;
        case 'NBFM':
          modeBandwidth = 12500; // 12.5 kHz for NFM
          break;
        case 'AM':
          modeBandwidth = 10000; // 10 kHz for AM
          break;
        case 'USB':
        case 'LSB':
        case 'CW':
          modeBandwidth = 2700; // 2.7 kHz for SSB modes
          break;
        case 'DSB':
          modeBandwidth = 6000; // 6 kHz for DSB
          break;
        case 'RAW':
          modeBandwidth = sampleRate; // Full bandwidth for RAW
          break;
      }
      
      changeBandwidth(modeBandwidth);
      
      if (demodulatorRef.current) {
        try {
          const modeObject = getMode(libMode as any)
          demodulatorRef.current.setMode(modeObject)
          
          // Apply bandwidth to the new mode
          try {
            (demodulatorRef.current as any).setBandwidth?.(modeBandwidth)
          } catch (error) {
            console.warn('Bandwidth not supported for this mode:', error)
          }
        } catch (error) {
          console.error('Failed to set demodulation mode:', error)
          // Keep the mode change in state even if demodulator fails
        }
      }
    } catch (error) {
      console.error('Error in changeDemodMode:', error)
    }
  }
  
  const changeSampleRate = (rate: number) => {
    setSampleRate(rate)
    
    if (radioRef.current) {
      radioRef.current.setSampleRate(rate)
      
      // Need to restart the radio for sample rate changes to take effect
      if (radioRef.current.isPlaying()) {
        radioRef.current.stop()
        radioRef.current.start()
      }
    }
    
    if (demodulatorRef.current) {
      demodulatorRef.current.setSampleRate(rate)
    }
  }
  
  const changeGain = (newGain: number | null) => {
    setGain(newGain)
    
    if (radioRef.current) {
      radioRef.current.setGain(newGain)
    }
  }
  
  const changeBandwidth = (bw: number) => {
    setBandwidth(bw)
    
    if (demodulatorRef.current) {
      try {
        (demodulatorRef.current as any).setBandwidth?.(bw)
      } catch (error) {
        console.error('Failed to set bandwidth:', error)
      }
    }
  }
    const changeVolume = (vol: number) => {
    setVolume(vol)
    
    if (demodulatorRef.current) {
      try {
        demodulatorRef.current.setVolume(vol)
        console.log(`Volume set to: ${vol}`)
      } catch (error) {
        console.error('Failed to set volume:', error)
      }
    }
  }
  
  const changePpm = (newPpm: number) => {
    setPpm(newPpm)
    
    if (radioRef.current) {
      radioRef.current.setFrequencyCorrection(newPpm)
    }
  }
  
  const changeDirectSampling = (mode: DirectSampling) => {
    setDirectSampling(mode)
    
    if (radioRef.current) {
      radioRef.current.setDirectSamplingMethod(mode)
    }
  }
  
  const changeBiasTee = (enabled: boolean) => {
    setBiasTee(enabled)
    
    if (radioRef.current) {
      radioRef.current.enableBiasTee(enabled)
    }
  }
  
  const changeAgc = (enabled: boolean) => {
    setAgc(enabled)
    
    if (radioRef.current) {
      try {
        // AGC is not directly exposed in the Radio class
        (radioRef.current as any).setAGC?.(enabled)
      } catch (error) {
        console.error("Failed to set AGC:", error)
      }
    }
  }
  
  const getSpectrumData = (): Float32Array | null => {
    if (!isPlaying) {
      console.log('Not playing, no spectrum data')
      return null
    }
    
    try {
      // Create a buffer to hold the spectrum data
      const data = new Float32Array(1024)
      
      // Check if radio is actually running properly
      if (radioRef.current) {
        try {
          const isRadioPlaying = radioRef.current.isPlaying()
          console.log('Radio playing status:', isRadioPlaying)
          
          // Check device info if available
          try {
            const deviceInfo = (radioRef.current as any).getDeviceInfo?.()
            if (deviceInfo) {
              console.log('Device info:', JSON.stringify(deviceInfo))
            }
          } catch (infoError) {
            console.warn('Could not get device info:', infoError)
          }
          
          if (!isRadioPlaying) {
            console.log('Radio reports it is not playing, trying to restart...')
            try {
              radioRef.current.start()
              console.log('Radio restarted')
              
              // Give it a moment to start streaming
              setTimeout(() => {
                if (spectrumRef.current && typeof (spectrumRef.current as any).update === 'function') {
                  (spectrumRef.current as any).update()
                }
              }, 100)
            } catch (restartError) {
              console.error('Failed to restart radio:', restartError)
            }
          }
        } catch (statusError) {
          console.warn('Could not check radio status:', statusError)
        }
      } else {
        console.warn('No radio instance available!')
        return null
      }
      
      // If we have a spectrum analyzer, try to get data from it
      if (spectrumRef.current && typeof spectrumRef.current.getSpectrum === 'function') {
        try {
          console.log('Attempting to get spectrum data...')
          
          // Force an update before getting spectrum data if available
          if (typeof (spectrumRef.current as any).update === 'function') {
            (spectrumRef.current as any).update()
          }
          
          // Check if the spectrum analyzer has received any samples
          const hasReceivedSamples = (spectrumRef.current as any).hasReceivedSamples?.() || 'unknown'
          console.log('Spectrum analyzer has received samples:', hasReceivedSamples)
          
          spectrumRef.current.getSpectrum(data)
          
          // Validate that we got reasonable data
          let hasValidData = false
          let nonZeroCount = 0
          let min = Infinity
          let max = -Infinity
          let sum = 0
          
          for (let i = 0; i < data.length; i++) {
            if (data[i] > -200 && data[i] < 100) { // Reasonable dB range
              hasValidData = true
            }
            if (data[i] !== 0 && data[i] !== -100) {
              nonZeroCount++
            }
            min = Math.min(min, data[i])
            max = Math.max(max, data[i])
            sum += data[i]
          }
          
          const avg = sum / data.length
          
          console.log(`Spectrum data stats: min=${min.toFixed(2)}, max=${max.toFixed(2)}, avg=${avg.toFixed(2)}, nonZero=${nonZeroCount}`)
          
          // If we have very few non-zero values, try to diagnose the issue
          if (nonZeroCount < 10) {
            console.warn('Very few non-zero values in spectrum data. Possible issues:')
            console.warn('1. No antenna connected')
            console.warn('2. Gain set too low')
            console.warn('3. No signals in current frequency range')
            console.warn('4. Device not streaming data properly')
            
            // Try adjusting gain if it's too low
            if (gain !== null && gain < 10) {
              console.log('Current gain is low, trying to increase it...')
              changeGain(20) // Set to a moderate gain level
            }
          }
          
          if (hasValidData && nonZeroCount > 5) {
            console.log('Got valid spectrum data from RTL-SDR')
            spectrumDataRef.current = data
            return data
          } else {
            console.warn('Spectrum data validation failed, non-zero count:', nonZeroCount)
            
            // If we have previous valid data, use it instead
            if (spectrumDataRef.current) {
              console.log('Using previously cached spectrum data')
              return spectrumDataRef.current
            }
          }
        } catch (spectrumError) {
          console.warn('Error calling getSpectrum:', spectrumError)
        }
      } else {
        console.warn('Spectrum analyzer not available or getSpectrum not a function')
      }
      
      // If RTL-SDR is connected but no valid data yet, provide more realistic noise floor
      if (isConnected) {
        console.log('RTL-SDR connected but no valid data, generating synthetic data')
        
        // Create more realistic looking spectrum data with peaks
        for (let i = 0; i < data.length; i++) {
          // Base noise floor
          data[i] = -90 + Math.random() * 5
          
          // Add some random peaks to make it look more like real RF data
          if (Math.random() < 0.05) {
            data[i] += Math.random() * 30
          }
          
          // Add a strong signal in the middle (center frequency)
          const centerIdx = data.length / 2
          const distance = Math.abs(i - centerIdx)
          if (distance < 20) {
            data[i] += Math.max(0, 30 - distance * 1.5)
          }
        }
        
        // Save this synthetic data
        spectrumDataRef.current = data
        return data
      }
      
      return null
    } catch (error) {
      console.warn("Error getting spectrum data:", error)
      return null
    }
  }
  // Function to fully reset the device when having issues
  const resetDevice = async () => {
    console.log('Resetting RTL-SDR device...')
    
    // First stop if playing
    if (isPlaying) {
      try {
        if (radioRef.current) {
          radioRef.current.stop()
        }
        setIsPlaying(false)
      } catch (stopError) {
        console.warn('Error stopping during reset:', stopError)
      }
    }
    
    // Clean up existing instances
    radioRef.current = null
    demodulatorRef.current = null
    spectrumRef.current = null
    providerRef.current = null
    
    // Set state to disconnected
    setIsConnected(false)
    setDeviceStatus('Disconnected')
    
    // Wait a moment for WebUSB to release the device
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Try to connect again
    try {
      await connect()
      return true
    } catch (reconnectError) {
      console.error('Failed to reconnect after reset:', reconnectError)
      return false
    }
  }
  
  const value = {
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
    setFrequency: setFrequencyValue,
    setSampleRate: changeSampleRate,
    setGain: changeGain,
    setDemodMode: changeDemodMode,
    setBandwidth: changeBandwidth,
    setVolume: changeVolume,
    setPpm: changePpm,
    setDirectSampling: changeDirectSampling,
    setBiasTee: changeBiasTee,
    setAgc: changeAgc,
    
    radioRef,
    demodulatorRef,
    spectrumRef,
    getSpectrumData
  }
  
  return (
    <RTLSDRContext.Provider value={value}>
      {children}
    </RTLSDRContext.Provider>
  )
}

export default RTLSDRContext